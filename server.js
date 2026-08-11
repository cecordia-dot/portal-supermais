const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERRO: defina DATABASE_URL apontando para um PostgreSQL.');
  process.exit(1);
}
const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSL === 'disable' || isLocal ? false : { rejectUnauthorized: false } });
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 7));

const clean = s => String(s ?? '').trim();
const num = v => { const s=String(v ?? '').trim(); if(!s)return 0; return Number(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s) || 0; };
const decimal = v => Math.max(0, num(v));
const int = v => Math.max(0, parseInt(v) || 0);
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`; }
function checkPassword(password, stored) { try { const [salt, hash] = stored.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), Buffer.from(hash, 'hex')); } catch { return false; } }
function json(res, status, body) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(body)); }
function parseBody(req) { return new Promise((resolve,reject)=>{ let data=''; req.on('data',c=>{ data+=c; if(data.length>5e6){reject(new Error('Payload muito grande')); req.destroy();}}); req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch(e){reject(e)}}); req.on('error',reject); }); }
function routeMatch(p,r){const m=p.match(r);return m?m.slice(1):null;}

async function initDb(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS associates (
      id BIGSERIAL PRIMARY KEY,
      corporate_name TEXT NOT NULL,
      trade_name TEXT NOT NULL,
      cnpj TEXT NOT NULL UNIQUE,
      phone TEXT,
      email TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','associate')),
      cnpj TEXT,
      associate_id BIGINT REFERENCES associates(id),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      ean TEXT,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL CHECK(price >= 0),
      stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK(stock >= 0),
      entry_date DATE,
      lot TEXT,
      expiry_date DATE,
      icon TEXT DEFAULT '📦',
      image_url TEXT,
      sysmo_name TEXT,
      sysmo_brand TEXT,
      sysmo_total_value NUMERIC(14,4),
      sysmo_unit_cost NUMERIC(14,4),
      lock_name BOOLEAN NOT NULL DEFAULT FALSE,
      lock_brand BOOLEAN NOT NULL DEFAULT FALSE,
      lock_category BOOLEAN NOT NULL DEFAULT FALSE,
      lock_unit BOOLEAN NOT NULL DEFAULT FALSE,
      lock_price BOOLEAN NOT NULL DEFAULT FALSE,
      lock_image BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'Recebido',
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price NUMERIC(12,2) NOT NULL CHECK(unit_price >= 0)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_products_active_name ON products(active,name);
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE products ALTER COLUMN stock TYPE NUMERIC(14,3) USING stock::numeric`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sysmo_name TEXT`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sysmo_brand TEXT`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sysmo_total_value NUMERIC(14,4)`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sysmo_unit_cost NUMERIC(14,4)`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS lock_name BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS lock_brand BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS lock_category BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS lock_unit BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS lock_price BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS lock_image BOOLEAN NOT NULL DEFAULT FALSE`);
  await seed();
}

async function seed(){
  let r = await pool.query('SELECT id FROM associates ORDER BY id LIMIT 1');
  let assocId = r.rows[0]?.id;
  if(!assocId){
    r = await pool.query('INSERT INTO associates(corporate_name,trade_name,cnpj,phone,email) VALUES($1,$2,$3,$4,$5) RETURNING id', ['Mercado Bom Preço Ltda','Mercado Bom Preço','00.000.000/0001-00','(49) 99999-0000','compras@bompreco.com.br']);
    assocId = r.rows[0].id;
  }
  if(!(await pool.query("SELECT 1 FROM users WHERE email='admin@supermais.com' LIMIT 1")).rowCount)
    await pool.query('INSERT INTO users(name,email,password_hash,role,active) VALUES($1,$2,$3,$4,TRUE)', ['Administrador','admin@supermais.com',hashPassword(process.env.SEED_ADMIN_PASSWORD || '123456'),'admin']);
  if(!(await pool.query("SELECT 1 FROM users WHERE email='mercado@supermais.com' LIMIT 1")).rowCount)
    await pool.query('INSERT INTO users(name,email,password_hash,role,cnpj,associate_id,active) VALUES($1,$2,$3,$4,$5,$6,TRUE)', ['Compras - Mercado Bom Preço','mercado@supermais.com',hashPassword(process.env.SEED_ASSOCIATE_PASSWORD || '123456'),'associate','00.000.000/0001-00',assocId]);
  else await pool.query("UPDATE users SET associate_id=$1 WHERE email='mercado@supermais.com' AND associate_id IS NULL",[assocId]);

  if(!(await pool.query('SELECT 1 FROM products LIMIT 1')).rowCount){
    const products=[
      ['ARR001','7896006711111','Arroz Branco 5kg','Tio João','Alimentos','Fardo c/ 6 un.',23.90,48,'2026-08-08','L2408','2027-08-08','🍚',''],
      ['FEI002','7896006702222','Feijão Carioca 1kg','Camil','Alimentos','Fardo c/ 12 un.',8.49,120,'2026-08-09','F0908','2027-02-09','🫘',''],
      ['OLE003','7894900010015','Óleo de Soja 900ml','Soya','Alimentos','Caixa c/ 20 un.',6.49,85,'2026-08-07','O0708','2027-08-07','🫗',''],
      ['CAF004','7896005800045','Café Tradicional 500g','3 Corações','Alimentos','Fardo c/ 20 un.',16.90,60,'2026-08-05','C0508','2027-08-05','☕',''],
      ['LEI005','7898215151701','Leite Integral 1L','Piracanjuba','Bebidas','Caixa c/ 12 un.',4.89,200,'2026-08-04','L0408','2027-02-04','🥛',''],
      ['ACU006',null,'Açúcar Cristal 5kg','União','Alimentos','Fardo c/ 6 un.',17.90,75,'2026-08-03','A0308','2028-08-03','🧂',''],
      ['PAP007',null,'Papel Higiênico Folha Dupla','Neve','Higiene','Fardo c/ 4 un.',21.90,30,'2026-08-02','P0208',null,'🧻',''],
      ['DET008',null,'Detergente Líquido 500ml','Ypê','Limpeza','Caixa c/ 24 un.',1.79,150,'2026-08-01','D0108','2028-08-01','🧴','']
    ];
    for(const p of products) await pool.query('INSERT INTO products(code,ean,name,brand,category,unit,price,stock,entry_date,lot,expiry_date,icon,image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',p);
  }
}

async function auth(req){
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token) return null;
  const r=await pool.query(`SELECT s.token,u.id,u.name,u.email,u.role,u.cnpj,u.associate_id,u.active,a.trade_name associate_name
    FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN associates a ON a.id=u.associate_id
    WHERE s.token=$1 AND s.expires_at>NOW() AND u.active=TRUE`,[token]);
  if(!r.rowCount) return null;
  return r.rows[0];
}
async function requireAuth(req,res,role){const u=await auth(req);if(!u){json(res,401,{error:'Sessão inválida ou expirada.'});return null}if(role&&u.role!==role){json(res,403,{error:'Sem permissão.'});return null}return u;}

async function api(req,res,url){
  const p=url.pathname; let m;
  if(p==='/api/health'&&req.method==='GET'){await pool.query('SELECT 1');return json(res,200,{ok:true});}
  if(p==='/api/login'&&req.method==='POST'){
    const b=await parseBody(req); const r=await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) AND active=TRUE LIMIT 1',[clean(b.email)]); const u=r.rows[0];
    if(!u||!checkPassword(String(b.password||''),u.password_hash)) return json(res,401,{error:'E-mail ou senha inválidos.'});
    const token=crypto.randomBytes(32).toString('hex'); await pool.query(`INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,NOW()+($3 || ' days')::interval)`,[token,u.id,String(SESSION_DAYS)]);
    const user=await auth({headers:{authorization:'Bearer '+token}}); return json(res,200,{token,user});
  }
  if(p==='/api/logout'&&req.method==='POST'){const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(token)await pool.query('DELETE FROM sessions WHERE token=$1',[token]);return json(res,200,{ok:true});}
  if(p==='/api/me'&&req.method==='GET'){const u=await requireAuth(req,res);if(!u)return;return json(res,200,{user:u});}

  if(p==='/api/products'&&req.method==='GET'){const u=await requireAuth(req,res);if(!u)return;const r=await pool.query('SELECT * FROM products WHERE active=TRUE ORDER BY name');return json(res,200,{products:r.rows});}
  if(p==='/api/products'&&req.method==='POST'){
    if(!await requireAuth(req,res,'admin'))return;const b=await parseBody(req);if(['code','name','brand','category','unit'].some(k=>!clean(b[k])))return json(res,400,{error:'Preencha os campos obrigatórios.'});
    const code=clean(b.code),client=await pool.connect();
    try{await client.query('BEGIN');const old=await client.query('SELECT id,active FROM products WHERE code=$1 FOR UPDATE',[code]);if(old.rowCount&&old.rows[0].active){await client.query('ROLLBACK');return json(res,400,{error:'Código já cadastrado.'});}if(old.rowCount&&!old.rows[0].active){await client.query("UPDATE products SET code='__ARQUIVADO__'||id||'__'||code,ean=NULL,updated_at=NOW() WHERE id=$1",[old.rows[0].id]);}
      const r=await client.query(`INSERT INTO products(code,ean,name,brand,category,unit,price,stock,entry_date,lot,expiry_date,icon,image_url,lock_name,lock_brand,lock_category,lock_unit,lock_price,lock_image) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,[code,clean(b.ean)||null,clean(b.name),clean(b.brand),clean(b.category),clean(b.unit),num(b.price),decimal(b.stock),b.entry_date||null,clean(b.lot)||null,b.expiry_date||null,clean(b.icon)||'📦',clean(b.image_url)||null,!!b.lock_name,!!b.lock_brand,!!b.lock_category,!!b.lock_unit,!!b.lock_price,!!b.lock_image]);await client.query('COMMIT');return json(res,201,{product:r.rows[0]});
    }catch(e){try{await client.query('ROLLBACK')}catch{}return json(res,400,{error:e.code==='23505'?'Código já cadastrado.':'Não foi possível cadastrar.'});}finally{client.release();}
  }
  if(p==='/api/products'&&req.method==='DELETE'){
    if(!await requireAuth(req,res,'admin'))return;const client=await pool.connect();
    try{await client.query('BEGIN');const archived=await client.query(`UPDATE products p SET active=FALSE,code='__ARQUIVADO__'||p.id||'__'||p.code,ean=NULL,updated_at=NOW() WHERE p.active=TRUE AND EXISTS(SELECT 1 FROM order_items oi WHERE oi.product_id=p.id) RETURNING p.id`);const removed=await client.query(`DELETE FROM products p WHERE p.active=TRUE AND NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.product_id=p.id) RETURNING p.id`);await client.query('COMMIT');return json(res,200,{ok:true,removed:removed.rowCount,archived:archived.rowCount,total:removed.rowCount+archived.rowCount});}catch(e){await client.query('ROLLBACK');return json(res,500,{error:'Não foi possível limpar o catálogo.'});}finally{client.release();}
  }
  m=routeMatch(p,/^\/api\/products\/(\d+)$/);
  if(m&&req.method==='PUT'){
    if(!await requireAuth(req,res,'admin'))return;const b=await parseBody(req),id=Number(m[0]);
    if(['code','name','brand','category','unit'].some(k=>!clean(b[k])))return json(res,400,{error:'Preencha os campos obrigatórios.'});
    try{const r=await pool.query(`UPDATE products SET code=$1,ean=$2,name=$3,brand=$4,category=$5,unit=$6,price=$7,stock=$8,entry_date=$9,lot=$10,expiry_date=$11,icon=$12,image_url=$13,lock_name=$14,lock_brand=$15,lock_category=$16,lock_unit=$17,lock_price=$18,lock_image=$19,updated_at=NOW() WHERE id=$20 RETURNING *`,[clean(b.code),clean(b.ean)||null,clean(b.name),clean(b.brand),clean(b.category),clean(b.unit),num(b.price),decimal(b.stock),b.entry_date||null,clean(b.lot)||null,b.expiry_date||null,clean(b.icon)||'📦',clean(b.image_url)||null,!!b.lock_name,!!b.lock_brand,!!b.lock_category,!!b.lock_unit,!!b.lock_price,!!b.lock_image,id]);if(!r.rowCount)return json(res,404,{error:'Produto não encontrado.'});return json(res,200,{product:r.rows[0]});}catch(e){return json(res,400,{error:e.code==='23505'?'Código já cadastrado.':'Não foi possível atualizar o produto.'});}
  }
  if(m&&req.method==='DELETE'){if(!await requireAuth(req,res,'admin'))return;const id=Number(m[0]),client=await pool.connect();try{await client.query('BEGIN');const used=await client.query('SELECT 1 FROM order_items WHERE product_id=$1 LIMIT 1',[id]);let archived=false;if(used.rowCount){await client.query("UPDATE products SET active=FALSE,code='__ARQUIVADO__'||id||'__'||code,ean=NULL,updated_at=NOW() WHERE id=$1",[id]);archived=true;}else{await client.query('DELETE FROM products WHERE id=$1',[id]);}await client.query('COMMIT');return json(res,200,{ok:true,archived});}catch(e){await client.query('ROLLBACK');return json(res,500,{error:'Não foi possível excluir o produto.'});}finally{client.release();}}

  if(p==='/api/products/import'&&req.method==='POST'){
    if(!await requireAuth(req,res,'admin'))return;
    const b=await parseBody(req),rows=Array.isArray(b.rows)?b.rows:[],source=clean(b.source||'standard').toLowerCase();
    if(!rows.length)return json(res,400,{error:'Nenhuma linha válida encontrada.'});
    const client=await pool.connect();let created=0,updated=0,errors=[],reviewPrice=0;
    try{
      await client.query('BEGIN');
      for(let i=0;i<rows.length;i++){
        const x=rows[i],code=clean(x.code),name=clean(x.name);
        if(!code||!name){if(errors.length<20)errors.push({line:i+1,error:'Código e produto são obrigatórios.'});continue;}
        try{
          const found=await client.query('SELECT * FROM products WHERE code=$1',[code]);
          if(source==='sysmo'){
            const stock=decimal(x.stock),totalValue=clean(x.sysmo_total_value)===''?null:num(x.sysmo_total_value);
            const unitCost=totalValue!==null&&stock>0?Number((totalValue/stock).toFixed(4)):null;
            if(found.rowCount){
              await client.query(`UPDATE products SET
                stock=$1,sysmo_name=$2,sysmo_brand=$3,sysmo_total_value=$4,sysmo_unit_cost=$5,
                name=CASE WHEN lock_name THEN name ELSE $2 END,
                brand=CASE WHEN lock_brand THEN brand ELSE $3 END,
                active=TRUE,updated_at=NOW()
                WHERE code=$6`,
                [stock,name,clean(x.brand)||'Sem marca',totalValue,unitCost,code]);
              updated++;
            }else{
              await client.query(`INSERT INTO products(code,name,brand,category,unit,price,stock,sysmo_name,sysmo_brand,sysmo_total_value,sysmo_unit_cost,active)
                VALUES($1,$2,$3,'Outros','Un.',0,$4,$2,$3,$5,$6,TRUE)`,
                [code,name,clean(x.brand)||'Sem marca',stock,totalValue,unitCost]);
              created++;reviewPrice++;
            }
          }else{
            if(found.rowCount){
              await client.query(`UPDATE products SET
                ean=$1,
                name=CASE WHEN lock_name THEN name ELSE $2 END,
                brand=CASE WHEN lock_brand THEN brand ELSE $3 END,
                category=CASE WHEN lock_category THEN category ELSE $4 END,
                unit=CASE WHEN lock_unit THEN unit ELSE $5 END,
                price=CASE WHEN lock_price THEN price ELSE $6 END,
                stock=$7,entry_date=$8,lot=$9,expiry_date=$10,
                image_url=CASE WHEN lock_image THEN image_url ELSE $11 END,
                active=TRUE,updated_at=NOW()
                WHERE code=$12`,
                [clean(x.ean)||null,name,clean(x.brand)||'Sem marca',clean(x.category)||'Outros',clean(x.unit)||'Un.',num(x.price),decimal(x.stock),x.entry_date||null,clean(x.lot)||null,x.expiry_date||null,clean(x.image_url)||null,code]);
              updated++;
            }else{
              await client.query(`INSERT INTO products(code,ean,name,brand,category,unit,price,stock,entry_date,lot,expiry_date,image_url,active)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)`,
                [code,clean(x.ean)||null,name,clean(x.brand)||'Sem marca',clean(x.category)||'Outros',clean(x.unit)||'Un.',num(x.price),decimal(x.stock),x.entry_date||null,clean(x.lot)||null,x.expiry_date||null,clean(x.image_url)||null]);
              created++;
            }
          }
        }catch(e){if(errors.length<20)errors.push({line:i+1,error:e.message});}
      }
      await client.query('COMMIT');
      return json(res,200,{created,updated,errors,total:rows.length,source,reviewPrice});
    }catch(e){await client.query('ROLLBACK');return json(res,400,{error:e.message});}
    finally{client.release();}
  }

  if(p==='/api/associates'&&req.method==='GET'){if(!await requireAuth(req,res,'admin'))return;const r=await pool.query(`SELECT a.*,COUNT(u.id)::int user_count FROM associates a LEFT JOIN users u ON u.associate_id=a.id AND u.active=TRUE GROUP BY a.id ORDER BY a.trade_name`);return json(res,200,{associates:r.rows});}
  if(p==='/api/associates'&&req.method==='POST'){
    if(!await requireAuth(req,res,'admin'))return;const b=await parseBody(req);if(!clean(b.corporate_name)||!clean(b.trade_name)||!clean(b.cnpj))return json(res,400,{error:'Razão social, nome fantasia e CNPJ são obrigatórios.'});
    try{const r=await pool.query('INSERT INTO associates(corporate_name,trade_name,cnpj,phone,email,active) VALUES($1,$2,$3,$4,$5,TRUE) RETURNING *',[clean(b.corporate_name),clean(b.trade_name),clean(b.cnpj),clean(b.phone)||null,clean(b.email)||null]);return json(res,201,{associate:r.rows[0]});}catch(e){return json(res,400,{error:e.code==='23505'?'CNPJ já cadastrado.':'Não foi possível cadastrar o associado.'});}
  }
  m=routeMatch(p,/^\/api\/associates\/(\d+)$/);
  if(m&&req.method==='PUT'){if(!await requireAuth(req,res,'admin'))return;const b=await parseBody(req),id=Number(m[0]);if(!clean(b.corporate_name)||!clean(b.trade_name)||!clean(b.cnpj))return json(res,400,{error:'Razão social, nome fantasia e CNPJ são obrigatórios.'});try{const r=await pool.query('UPDATE associates SET corporate_name=$1,trade_name=$2,cnpj=$3,phone=$4,email=$5,active=$6 WHERE id=$7 RETURNING *',[clean(b.corporate_name),clean(b.trade_name),clean(b.cnpj),clean(b.phone)||null,clean(b.email)||null,b.active===0?false:true,id]);if(!r.rowCount)return json(res,404,{error:'Associado não encontrado.'});return json(res,200,{associate:r.rows[0]});}catch(e){return json(res,400,{error:e.code==='23505'?'CNPJ já cadastrado.':'Não foi possível atualizar o associado.'});}}
  if(m&&req.method==='DELETE'){if(!await requireAuth(req,res,'admin'))return;const id=Number(m[0]);await pool.query('UPDATE associates SET active=FALSE WHERE id=$1',[id]);await pool.query('UPDATE users SET active=FALSE WHERE associate_id=$1',[id]);return json(res,200,{ok:true});}

  if(p==='/api/users'&&req.method==='GET'){if(!await requireAuth(req,res,'admin'))return;const r=await pool.query(`SELECT u.id,u.name,u.email,u.role,u.cnpj,u.associate_id,u.active,u.created_at,a.trade_name associate_name FROM users u LEFT JOIN associates a ON a.id=u.associate_id WHERE u.deleted_at IS NULL ORDER BY u.name`);return json(res,200,{users:r.rows});}
  if(p==='/api/users'&&req.method==='POST'){
    if(!await requireAuth(req,res,'admin'))return;const b=await parseBody(req);if(!clean(b.name)||!clean(b.email)||!clean(b.password))return json(res,400,{error:'Nome, e-mail e senha são obrigatórios.'});if(clean(b.password).length<8)return json(res,400,{error:'A senha deve ter pelo menos 8 caracteres.'});const role=b.role==='admin'?'admin':'associate';if(role==='associate'&&!Number(b.associate_id))return json(res,400,{error:'Selecione o associado.'});
    try{let assoc=null;if(role==='associate'){const ar=await pool.query('SELECT cnpj FROM associates WHERE id=$1 AND active=TRUE',[Number(b.associate_id)]);assoc=ar.rows[0];if(!assoc)return json(res,400,{error:'Associado inválido.'});}const r=await pool.query('INSERT INTO users(name,email,password_hash,role,cnpj,associate_id,active) VALUES($1,$2,$3,$4,$5,$6,TRUE) RETURNING id',[clean(b.name),clean(b.email).toLowerCase(),hashPassword(clean(b.password)),role,assoc?.cnpj||null,role==='associate'?Number(b.associate_id):null]);return json(res,201,{id:Number(r.rows[0].id)});}catch(e){return json(res,400,{error:e.code==='23505'?'E-mail já cadastrado.':'Não foi possível criar o usuário.'});}
  }
  m=routeMatch(p,/^\/api\/users\/(\d+)$/);
  if(m&&req.method==='PUT'){if(!await requireAuth(req,res,'admin'))return;const b=await parseBody(req),id=Number(m[0]);if(!clean(b.name)||!clean(b.email))return json(res,400,{error:'Nome e e-mail são obrigatórios.'});const cr=await pool.query('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL',[id]);if(!cr.rowCount)return json(res,404,{error:'Usuário não encontrado.'});const role=b.role==='admin'?'admin':'associate';let assoc=null;if(role==='associate'){if(!Number(b.associate_id))return json(res,400,{error:'Selecione o associado.'});const ar=await pool.query('SELECT cnpj FROM associates WHERE id=$1 AND active=TRUE',[Number(b.associate_id)]);assoc=ar.rows[0];if(!assoc)return json(res,400,{error:'Associado inválido ou inativo.'});}try{if(clean(b.password)){if(clean(b.password).length<8)return json(res,400,{error:'A senha deve ter pelo menos 8 caracteres.'});await pool.query('UPDATE users SET name=$1,email=$2,role=$3,cnpj=$4,associate_id=$5,active=$6,password_hash=$7 WHERE id=$8',[clean(b.name),clean(b.email).toLowerCase(),role,assoc?.cnpj||null,role==='associate'?Number(b.associate_id):null,b.active===0?false:true,hashPassword(clean(b.password)),id]);}else await pool.query('UPDATE users SET name=$1,email=$2,role=$3,cnpj=$4,associate_id=$5,active=$6 WHERE id=$7',[clean(b.name),clean(b.email).toLowerCase(),role,assoc?.cnpj||null,role==='associate'?Number(b.associate_id):null,b.active===0?false:true,id]);return json(res,200,{ok:true});}catch(e){return json(res,400,{error:e.code==='23505'?'E-mail já cadastrado.':'Não foi possível atualizar o usuário.'});}}
  if(m&&req.method==='DELETE'){
    const admin=await requireAuth(req,res,'admin');if(!admin)return;
    const id=Number(m[0]);
    if(Number(admin.id)===id)return json(res,400,{error:'Você não pode excluir o próprio usuário.'});
    const cr=await pool.query('SELECT id,role,active FROM users WHERE id=$1 AND deleted_at IS NULL',[id]);
    if(!cr.rowCount)return json(res,404,{error:'Usuário não encontrado.'});
    if(cr.rows[0].role==='admin'&&cr.rows[0].active){
      const admins=await pool.query("SELECT COUNT(*)::int n FROM users WHERE role='admin' AND active=TRUE AND deleted_at IS NULL");
      if(admins.rows[0].n<=1)return json(res,400,{error:'Não é possível excluir o último administrador ativo.'});
    }
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('DELETE FROM sessions WHERE user_id=$1',[id]);
      await client.query(`UPDATE users SET active=FALSE,deleted_at=NOW(),email='excluido-'||id||'-'||floor(extract(epoch from NOW()))::bigint||'@supermais.invalid' WHERE id=$1`,[id]);
      await client.query('COMMIT');
      return json(res,200,{ok:true});
    }catch(e){await client.query('ROLLBACK');return json(res,500,{error:'Não foi possível excluir o usuário.'});}
    finally{client.release();}
  }

  if(p==='/api/orders'&&req.method==='GET'){
    const u=await requireAuth(req,res);if(!u)return;let r;if(u.role==='admin')r=await pool.query(`SELECT o.*,COALESCE(a.trade_name,u.name) associate_name FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN associates a ON a.id=u.associate_id ORDER BY o.id DESC`);else r=await pool.query(`SELECT o.*,COALESCE(a.trade_name,u.name) associate_name FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN associates a ON a.id=u.associate_id WHERE u.associate_id=$1 ORDER BY o.id DESC`,[u.associate_id]);const ids=r.rows.map(x=>x.id);let itemRows=[];if(ids.length){const ir=await pool.query(`SELECT oi.*,p.name,p.code,p.unit FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id = ANY($1::bigint[]) ORDER BY oi.id`,[ids]);itemRows=ir.rows;}const grouped={};for(const it of itemRows)(grouped[it.order_id]??=[]).push(it);return json(res,200,{orders:r.rows.map(o=>({...o,items:grouped[o.id]||[]}))});
  }
  if(p==='/api/orders'&&req.method==='POST'){
    const u=await requireAuth(req,res,'associate');if(!u)return;const b=await parseBody(req),items=Array.isArray(b.items)?b.items:[];if(!items.length)return json(res,400,{error:'Carrinho vazio.'});
    const client=await pool.connect();try{await client.query('BEGIN');let total=0;const norm=[];for(const item of items){const q=Math.max(1,parseInt(item.quantity)||0);const pr=await client.query('SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE',[Number(item.product_id)]);const prod=pr.rows[0];if(!prod)throw new Error('Produto não encontrado.');if(prod.stock<q)throw new Error(`Estoque insuficiente para ${prod.name}. Disponível: ${prod.stock}.`);total+=Number(prod.price)*q;norm.push({prod,q});}const or=await client.query('INSERT INTO orders(user_id,status,total) VALUES($1,$2,$3) RETURNING id',[u.id,'Recebido',total]);const orderId=or.rows[0].id;for(const {prod,q} of norm){await client.query('INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES($1,$2,$3,$4)',[orderId,prod.id,q,prod.price]);await client.query('UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2',[q,prod.id]);}await client.query('COMMIT');return json(res,201,{order_id:Number(orderId),total});}catch(e){await client.query('ROLLBACK');return json(res,400,{error:e.message});}finally{client.release();}
  }
  m=routeMatch(p,/^\/api\/orders\/(\d+)\/status$/);
  if(m&&req.method==='PUT'){
    if(!await requireAuth(req,res,'admin'))return;
    const b=await parseBody(req),allowed=['Recebido','Separando','Pronto','Entregue','Cancelado'],id=Number(m[0]);
    if(!allowed.includes(b.status))return json(res,400,{error:'Status inválido.'});
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const or=await client.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE',[id]);
      if(!or.rowCount){await client.query('ROLLBACK');return json(res,404,{error:'Pedido não encontrado.'});}
      const old=or.rows[0].status;
      if(old===b.status){await client.query('COMMIT');return json(res,200,{ok:true});}
      const items=(await client.query('SELECT product_id,quantity FROM order_items WHERE order_id=$1',[id])).rows;
      if(b.status==='Cancelado'&&old!=='Cancelado'){
        for(const it of items)await client.query('UPDATE products SET stock=stock+$1,updated_at=NOW() WHERE id=$2',[it.quantity,it.product_id]);
      }else if(old==='Cancelado'&&b.status!=='Cancelado'){
        for(const it of items){const pr=await client.query('SELECT stock,name FROM products WHERE id=$1 FOR UPDATE',[it.product_id]);if(!pr.rowCount||Number(pr.rows[0].stock)<Number(it.quantity))throw new Error(`Estoque insuficiente para reabrir o pedido: ${pr.rows[0]?.name||'produto'}.`);}
        for(const it of items)await client.query('UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2',[it.quantity,it.product_id]);
      }
      await client.query('UPDATE orders SET status=$1 WHERE id=$2',[b.status,id]);
      await client.query('COMMIT');return json(res,200,{ok:true});
    }catch(e){await client.query('ROLLBACK');return json(res,400,{error:e.message});}finally{client.release();}
  }

  if(p==='/api/admin/stats'&&req.method==='GET'){
    if(!await requireAuth(req,res,'admin'))return;const [products,associates,users,open,month]=await Promise.all([
      pool.query('SELECT COUNT(*)::int n FROM products WHERE active=TRUE'),pool.query('SELECT COUNT(*)::int n FROM associates WHERE active=TRUE'),pool.query('SELECT COUNT(*)::int n FROM users WHERE active=TRUE AND deleted_at IS NULL'),pool.query("SELECT COUNT(*)::int n FROM orders WHERE status NOT IN ('Entregue','Cancelado')"),pool.query("SELECT COALESCE(SUM(total),0)::numeric n FROM orders WHERE status!='Cancelado' AND created_at>=date_trunc('month',CURRENT_DATE)")]);
    return json(res,200,{stats:{products:products.rows[0].n,associates:associates.rows[0].n,users:users.rows[0].n,open_orders:open.rows[0].n,month_sales:Number(month.rows[0].n)}});
  }
  return json(res,404,{error:'Rota não encontrada.'});
}

function serveStatic(req,res,url){let pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);const file=path.normalize(path.join(ROOT,pathname));if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden')}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found')}const ext=path.extname(file).toLowerCase();const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.csv':'text/csv; charset=utf-8'};const cache=['.png','.jpg','.jpeg','.svg'].includes(ext)?'public, max-age=86400':'no-cache';res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':cache,'X-Content-Type-Options':'nosniff'});res.end(data);});}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);try{if(url.pathname.startsWith('/api/'))return await api(req,res,url);serveStatic(req,res,url)}catch(e){console.error(e);json(res,500,{error:'Erro interno do servidor.'})}});

initDb().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`Rede Super Mais v8 rodando na porta ${PORT}`))).catch(e=>{console.error('Falha ao iniciar banco:',e);process.exit(1)});
