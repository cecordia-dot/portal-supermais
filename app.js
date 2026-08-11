const state = {
  token: localStorage.getItem('sm_token') || '',
  user: null,
  products: [], orders: [], associates: [], users: [], stats: {},
  cart: safeJSON(localStorage.getItem('sm_cart'), []),
  view: 'dashboard', search: '', category: 'Todos',
  editing: null, editingAssociate: null, editingUser: null,
  profileOpen: false, orderOpen: null,
  busy: false,
};

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const byId = id => document.getElementById(id);
const val = id => byId(id)?.value ?? '';
const checked = id => !!byId(id)?.checked;
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = v => Number(v || 0).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const qtyBR = v => Number(v || 0).toLocaleString('pt-BR', {maximumFractionDigits:3});
function safeJSON(text, fallback){ try{return text ? JSON.parse(text) : fallback}catch{return fallback} }
function dateBR(v){ if(!v)return '—'; const d=new Date(String(v).length<=10?`${v}T12:00:00`:v); return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR'); }
function dateTimeBR(v){ if(!v)return '—'; const d=new Date(v); return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}); }
function sameId(a,b){ return String(a) === String(b); }
function setBusy(value){ state.busy=value; document.body.classList.toggle('is-busy', value); }

async function api(url, opt={}){
  const headers = {...(opt.headers||{})};
  if(opt.body && !(opt.body instanceof FormData)) headers['Content-Type']='application/json';
  if(state.token) headers.Authorization = `Bearer ${state.token}`;
  const r = await fetch(url, {...opt, headers});
  const d = await r.json().catch(()=>({}));
  if(!r.ok){
    if(r.status===401 && state.user) logout(false);
    throw new Error(d.error || 'Erro na operação.');
  }
  return d;
}

function toast(msg, bad=false){
  let t=$('.toast');
  if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}
  t.textContent=msg; t.className=`toast ${bad?'bad ':''}show`;
  clearTimeout(window._toast); window._toast=setTimeout(()=>t.classList.remove('show'),3000);
}
function saveCart(){ localStorage.setItem('sm_cart', JSON.stringify(state.cart)); }
function reconcileCart(){
  state.cart = state.cart.map(item=>{
    const p=state.products.find(x=>sameId(x.id,item.id));
    if(!p || Number(p.stock)<=0) return null;
    return {...item, price:Number(p.price), stock:Number(p.stock), name:p.name, unit:p.unit, icon:p.icon, image_url:p.image_url, qty:Math.max(1,Math.min(Number(item.qty)||1,Math.floor(Number(p.stock))))};
  }).filter(Boolean);
  saveCart();
}

async function boot(){
  if(state.token){
    try{ state.user=(await api('/api/me')).user; await refreshData(); }
    catch{ state.token=''; localStorage.removeItem('sm_token'); }
  }
  render();
}
async function refreshData(){
  if(!state.user)return;
  const [p,o]=await Promise.all([api('/api/products'),api('/api/orders')]);
  state.products=p.products||[]; state.orders=o.orders||[]; reconcileCart();
  if(state.user.role==='admin'){
    const [a,u,s]=await Promise.all([api('/api/associates'),api('/api/users'),api('/api/admin/stats')]);
    state.associates=a.associates||[]; state.users=u.users||[]; state.stats=s.stats||{};
  }
}
async function login(){
  const email=val('login_email').trim(), password=val('login_password');
  if(!email||!password)return toast('Informe e-mail e senha.',true);
  try{
    setBusy(true);
    const d=await api('/api/login',{method:'POST',body:JSON.stringify({email,password})});
    state.token=d.token; state.user=d.user; localStorage.setItem('sm_token',d.token); state.view='dashboard';
    await refreshData(); render();
  }catch(e){toast(e.message,true)}finally{setBusy(false)}
}
async function logout(call=true){
  if(call)try{await api('/api/logout',{method:'POST'})}catch{}
  state.token=''; state.user=null; state.profileOpen=false; localStorage.removeItem('sm_token'); render();
}
function setView(v){
  state.view=v; state.editing=null; state.editingAssociate=null; state.editingUser=null; state.profileOpen=false; state.orderOpen=null;
  document.body.classList.remove('menu-open'); render(); window.scrollTo({top:0,behavior:'smooth'});
}
function toggleProfile(){ state.profileOpen=!state.profileOpen; render(); }
function toggleMenu(){ document.body.classList.toggle('menu-open'); }

function loginPage(){return `
<div class="login-wrap">
  <section class="login-brand"><div class="login-brand-inner"><img src="logo-supermais.png" alt="Rede Super Mais"><h2>Portal de compras</h2><p>Estoque, pedidos e associados em um só lugar.</p></div></section>
  <section class="login-side"><form class="login-card" onsubmit="event.preventDefault();login()">
    <span class="eyebrow">ACESSO RESTRITO</span><h1>Bem-vindo</h1><p>Entre com seu usuário para continuar.</p>
    <div class="field"><label for="login_email">E-mail</label><input id="login_email" type="email" autocomplete="username" value="mercado@supermais.com"></div>
    <div class="field"><label for="login_password">Senha</label><input id="login_password" type="password" autocomplete="current-password" value="123456"></div>
    <button class="btn btn-primary full" type="submit">Entrar</button>
    <details class="demo-details"><summary>Acessos de teste</summary><div><b>Associado:</b> mercado@supermais.com / 123456<br><b>Admin:</b> admin@supermais.com / 123456</div></details>
  </form></section>
</div>`}

function navBtn(v,icon,label,count=''){return `<button class="nav-item ${state.view===v?'active':''}" onclick="setView('${v}')"><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>${count?`<span class="nav-count">${count}</span>`:''}</button>`}
function layout(content){
  const admin=state.user.role==='admin', cartCount=state.cart.reduce((s,x)=>s+Number(x.qty||0),0);
  return `<div class="app-shell">
  <div class="mobile-overlay" onclick="toggleMenu()"></div>
  <aside class="sidebar">
    <div class="sidebar-logo"><img src="logo-supermais-transparente.png" alt="Rede Super Mais"></div>
    <div class="side-group-title">Menu</div>
    <nav class="side-nav">
      ${navBtn('dashboard','⌂','Início')}
      ${navBtn('products','▦',admin?'Produtos e estoque':'Produtos')}
      ${admin?navBtn('associates','🏪','Associados'):navBtn('cart','🛒','Carrinho',cartCount||'')}
      ${navBtn('orders','📋',admin?'Pedidos':'Meus pedidos')}
      ${admin?navBtn('users','👥','Usuários'):''}
      ${admin?navBtn('import','⇧','Importar dados'):''}
    </nav>
    <div class="sidebar-footer">
      <div class="user-mini"><div class="avatar">${esc(state.user.name?.[0]||'?')}</div><div><b>${esc(state.user.name)}</b><small>${admin?'Administrador':esc(state.user.associate_name||'Associado')}</small></div></div>
      <button class="btn btn-light full" onclick="logout()">Sair</button>
      <div class="promo"><b>📱 Versão PWA</b><span>Instale na tela inicial do celular.</span></div>
    </div>
  </aside>
  <main class="main">
    <header class="topbar">
      <button class="mobile-menu" aria-label="Abrir menu" onclick="toggleMenu()">☰</button>
      <div class="search-global"><input id="global_product_search" aria-label="Buscar produtos" placeholder="Buscar produtos..." value="${esc(state.search)}" oninput="updateProductSearch(this.value,'global_product_search',true)"><span>⌕</span></div>
      <div class="top-spacer"></div>
      <div class="profile-wrap">
        <button class="top-user" onclick="toggleProfile()" aria-expanded="${state.profileOpen}">
          <div class="avatar top-avatar">${esc(state.user.name?.[0]||'?')}</div>
          <div class="top-user-copy"><b>${esc(state.user.name)}</b><span>${admin?'Administrador':esc(state.user.associate_name||'Associado')}</span></div>
          <span class="top-user-chevron">⌄</span>
        </button>
        ${state.profileOpen?`<div class="profile-menu"><div><b>${esc(state.user.name)}</b><span>${esc(state.user.email)}</span></div><button onclick="logout()">Sair da conta</button></div>`:''}
      </div>
    </header>
    <div class="content">${content}</div>
    ${!admin?mobileNav():''}
  </main></div>`;
}
function syncSearchInputs(v,sourceId=''){
  ['global_product_search','catalog_product_search','admin_product_search'].forEach(id=>{if(id!==sourceId){const el=byId(id);if(el&&el.value!==v)el.value=v}});
}
function applyLiveProductFilter(v){
  state.search=v;
  const q=String(v||'').toLowerCase().trim();
  let visible=0;
  document.querySelectorAll('[data-product-search]').forEach(el=>{
    const hit=!q||String(el.dataset.productSearch||'').includes(q);
    const catOk=state.category==='Todos'||el.dataset.productCategory===String(state.category||'');
    const show=hit&&catOk;
    el.style.display=show?'':'none';
    if(show)visible++;
  });
  const count=byId('catalog_result_count'); if(count) count.textContent=`${visible} produtos encontrados`;
  const adminCount=byId('admin_product_count'); if(adminCount) adminCount.textContent=visible;
}
function updateProductSearch(v, focusId, forceProducts=false){
  state.search=v;
  syncSearchInputs(v,focusId);
  if(forceProducts && state.view!=='products'){
    state.view='products';
    render();
    requestAnimationFrame(()=>{const input=byId('catalog_product_search')||byId('global_product_search');if(input){input.focus();try{input.setSelectionRange(input.value.length,input.value.length)}catch{}}});
    return;
  }
  applyLiveProductFilter(v);
}
function globalSearch(v){ updateProductSearch(v,'global_product_search',true); }
function mobileNav(){const cartCount=state.cart.reduce((s,x)=>s+Number(x.qty||0),0);return `<nav class="mobile-bottom" aria-label="Navegação principal">${[['dashboard','⌂','Início'],['products','▦','Produtos'],['cart','🛒','Carrinho'],['orders','📋','Pedidos']].map(x=>`<button class="${state.view===x[0]?'active':''}" onclick="setView('${x[0]}')"><span class="mobile-nav-icon">${x[1]}${x[0]==='cart'&&cartCount?`<i>${cartCount>99?'99+':cartCount}</i>`:''}</span><small>${x[2]}</small></button>`).join('')}</nav>`}

function pageTitle(eyebrow,title,desc,action=''){return `<div class="page-title"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${desc}</p></div>${action}</div>`}
function statCard(icon,value,label){return `<div class="stat-card"><div class="stat-icon">${icon}</div><div><div class="stat-number ${String(value).length>12?'small-money':''}">${value}</div><div class="stat-label">${label}</div></div></div>`}
function dashboard(){return state.user.role==='admin'?adminDashboard():associateDashboard()}
function associateDashboard(){
  const low=state.products.filter(p=>Number(p.stock)<30).length;
  return `<div class="hero"><div><span class="eyebrow light">REDE SUPER MAIS</span><h1>Olá, ${esc(state.user.associate_name||state.user.name)} 👋</h1><p>Consulte o estoque e monte seu pedido direto pelo portal.</p><button class="btn btn-white" onclick="setView('products')">Ver catálogo →</button></div><div class="hero-art">🛒</div></div>
  <div class="stats">${statCard('▦',state.products.length,'Produtos disponíveis')}${statCard('📋',state.orders.length,'Pedidos realizados')}${statCard('🛒',state.cart.reduce((s,x)=>s+x.qty,0),'Itens no carrinho')}${statCard('⚠',low,'Produtos com estoque baixo')}</div>
  <div class="section-head"><h2>Categorias</h2><button class="link-btn" onclick="setView('products')">Ver tudo</button></div>
  <div class="categories">${categories().slice(0,6).map(c=>`<button class="category-card" onclick="chooseCategory('${encodeURIComponent(c)}')"><div class="category-icon">${catIcon(c)}</div><div class="category-name">${esc(c)}</div><small>${state.products.filter(p=>p.category===c).length} produtos</small></button>`).join('')}</div>
  <div class="section-head"><h2>Pedidos recentes</h2><button class="link-btn" onclick="setView('orders')">Ver histórico</button></div>${orderTable(state.orders.slice(0,4),false,true)}`;
}
function chooseCategory(encoded){ state.category=decodeURIComponent(encoded); setView('products'); }
function adminDashboard(){
  const s=state.stats, low=state.products.slice().sort((a,b)=>Number(a.stock)-Number(b.stock)).slice(0,7);
  return `${pageTitle('PAINEL ADMINISTRATIVO','Visão geral','Acompanhe a operação da central em um só lugar.',`<button class="btn btn-primary" onclick="setView('import')">⇧ Importar estoque</button>`)}
  <div class="stats">${statCard('▦',s.products||0,'Produtos ativos')}${statCard('🏪',s.associates||0,'Associados ativos')}${statCard('📦',s.open_orders||0,'Pedidos em aberto')}${statCard('R$',money(s.month_sales||0),'Pedidos do mês')}</div>
  <div class="admin-grid"><section><div class="section-head"><h2>Pedidos recentes</h2><button class="link-btn" onclick="setView('orders')">Ver todos</button></div>${orderTable(state.orders.slice(0,6),true,true)}</section>
  <section><div class="section-head"><h2>Atenção no estoque</h2><button class="link-btn" onclick="setView('products')">Abrir estoque</button></div><div class="panel stock-list">${low.length?low.map(p=>`<button class="stock-row" onclick="focusProduct('${encodeURIComponent(p.code)}')"><span><b>${esc(p.name)}</b><small>Cód. ${esc(p.code)}</small></span><b class="${Number(p.stock)<20?'danger-text':Number(p.stock)<50?'warning-text':''}">${qtyBR(p.stock)}</b></button>`).join(''):'<div class="empty compact">Nenhum produto.</div>'}</div></section></div>`;
}
function focusProduct(code){ state.search=decodeURIComponent(code); setView('products'); }

function categories(){return [...new Set(state.products.map(p=>p.category||'Outros'))].sort((a,b)=>a.localeCompare(b,'pt-BR'))}
function catIcon(c){const x=String(c).toLowerCase();return x.includes('beb')?'🥤':x.includes('limp')?'🧴':x.includes('higi')?'🧻':x.includes('aliment')?'🍚':'📦'}
function filteredProducts(){const q=state.search.toLowerCase().trim();return state.products.filter(p=>(state.category==='Todos'||p.category===state.category)&&(!q||[p.name,p.brand,p.code,p.ean,p.category,p.unit].some(v=>String(v||'').toLowerCase().includes(q))))}
function productThumb(p){return p.image_url?`<div class="product-thumb"><img src="${esc(p.image_url)}" alt="${esc(p.name)}" onerror="this.parentElement.textContent='${esc(p.icon||'📦')}'"></div>`:`<div class="product-thumb">${esc(p.icon||'📦')}</div>`}
function products(){return state.user.role==='admin'?adminProducts():associateProducts()}
function associateProducts(){
  const list=filteredProducts(), cartCount=state.cart.reduce((s,x)=>s+x.qty,0);
  return `${pageTitle('CATÁLOGO','Produtos disponíveis','Preços e estoque atualizados pela central.',`<button class="btn btn-primary" onclick="setView('cart')">🛒 Carrinho (${cartCount})</button>`)}
  <div class="catalog-layout"><aside class="filter-panel"><div class="field"><label>Buscar</label><input id="catalog_product_search" placeholder="Produto, marca, código..." value="${esc(state.search)}" oninput="updateProductSearch(this.value,'catalog_product_search')"></div><label class="filter-label">Categoria</label><div class="filter-cats"><button class="${state.category==='Todos'?'active':''}" onclick="state.category='Todos';render()">Todas</button>${categories().map(c=>`<button class="${state.category===c?'active':''}" onclick="state.category=decodeURIComponent('${encodeURIComponent(c)}');render()">${esc(c)}</button>`).join('')}</div></aside>
  <section><div class="catalog-head"><div><h2>${esc(state.category)}</h2><span class="meta" id="catalog_result_count">${list.length} produtos encontrados</span></div>${state.search||state.category!=='Todos'?`<button class="btn btn-ghost" onclick="clearProductFilters()">Limpar filtros</button>`:''}</div>
  <div class="product-grid">${list.length?list.map(productCard).join(''):'<div class="panel empty wide">Nenhum produto encontrado com esses filtros.</div>'}</div></section></div>${mobileCartDock(cartCount)}`;
}
function clearProductFilters(){state.search='';state.category='Todos';render()}
function mobileCartDock(count){if(!count)return '';const total=state.cart.reduce((sum,x)=>sum+Number(x.price||0)*Number(x.qty||0),0);return `<button class="mobile-cart-dock" onclick="setView('cart')"><span><b>🛒 ${count} ${count===1?'item':'itens'}</b><small>Ver carrinho</small></span><strong>${money(total)}</strong></button>`}
function productCard(p){
  const stock=Number(p.stock), unavailable=stock<=0, price=Number(p.price);
  const searchText=[p.name,p.brand,p.code,p.ean,p.category,p.unit].map(v=>String(v||'').toLowerCase()).join(' ');
  return `<article class="product-card ${unavailable?'out':''}" data-product-search="${esc(searchText)}" data-product-category="${esc(p.category||'Outros')}">${productThumb(p)}<span class="code">Cód. ${esc(p.code)}${p.ean?' · '+esc(p.ean):''}</span><h3>${esc(p.name)}</h3><div class="product-brand">${esc(p.brand)}</div><div class="product-price">${price>0?money(price):'<span class="price-review">Preço sob consulta</span>'}</div><div class="product-unit">${esc(p.unit)}</div><div class="stock ${stock<20?'critical':stock<50?'low':'ok'}">● ${unavailable?'Sem estoque':`${qtyBR(stock)} em estoque`}</div><div class="product-entry">Entrada: ${dateBR(p.entry_date)} · Lote: ${esc(p.lot||'—')}</div><div class="product-actions"><input id="q${p.id}" aria-label="Quantidade" inputmode="numeric" type="number" min="1" max="${Math.floor(stock)}" value="1" ${unavailable?'disabled':''}><button class="btn btn-primary" onclick="addCart('${p.id}')" ${unavailable?'disabled':''}>Adicionar</button></div></article>`;
}
function addCart(id){
  const p=state.products.find(x=>sameId(x.id,id)); if(!p)return toast('Produto não encontrado. Atualize a página.',true);
  const stock=Number(p.stock), price=Number(p.price); if(stock<=0)return toast('Produto sem estoque.',true);
  const input=byId(`q${p.id}`), requested=Math.max(1,Math.floor(Number(input?.value)||1)); const qty=Math.min(Math.floor(stock),requested);
  const existing=state.cart.find(x=>sameId(x.id,p.id));
  if(existing) existing.qty=Math.min(Math.floor(stock),Number(existing.qty)+qty); else state.cart.push({id:p.id,name:p.name,unit:p.unit,price,image_url:p.image_url,icon:p.icon,stock,qty});
  saveCart(); toast(`${p.name} adicionado ao carrinho.`); render();
}

function adminProducts(){
  const list=filteredProducts();
  return `${pageTitle('CADASTRO E ESTOQUE','Produtos','Cadastre, ajuste o catálogo e acompanhe o estoque.',`<div class="actions product-page-actions"><button class="btn btn-danger-soft" onclick="clearProductCatalog()" ${state.products.length?'':'disabled'}>⌫ Limpar catálogo</button><button class="btn btn-light" onclick="setView('import')">⇧ Importar CSV</button><button class="btn btn-primary" onclick="openProductForm()">+ Produto</button></div>`)}
  ${state.editing!==null?productForm():''}
  <div class="panel toolbar"><div class="toolbar-search"><span>⌕</span><input id="admin_product_search" placeholder="Buscar produto, código ou marca..." value="${esc(state.search)}" oninput="updateProductSearch(this.value,'admin_product_search')"></div><div class="toolbar-meta"><b id="admin_product_count">${list.length}</b> produtos</div></div>
  <div class="panel table-wrap"><table class="table"><thead><tr><th>Produto</th><th>Código / EAN</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Entrada</th><th class="actions-col">Ações</th></tr></thead><tbody>${list.map(p=>`<tr data-product-search="${esc([p.name,p.brand,p.code,p.ean,p.category,p.unit].map(v=>String(v||'').toLowerCase()).join(' '))}" data-product-category="${esc(p.category||'Outros')}"><td data-label="Produto"><div class="table-product">${p.image_url?`<img src="${esc(p.image_url)}" alt="">`:`<span>${esc(p.icon||'📦')}</span>`}<div><b>${esc(p.name)}</b><small>${esc(p.brand)}</small></div></div></td><td data-label="Código / EAN"><b>${esc(p.code)}</b><small>${esc(p.ean||'—')}</small></td><td data-label="Categoria">${esc(p.category)}</td><td data-label="Preço"><b>${money(p.price)}</b>${Number(p.price)<=0?'<small class="danger-text">Revisar preço</small>':''}</td><td data-label="Estoque"><span class="pill ${Number(p.stock)<20?'red':Number(p.stock)<50?'yellow':'green'}">${qtyBR(p.stock)}</span></td><td data-label="Entrada">${dateBR(p.entry_date)}</td><td data-label="Ações"><div class="row-actions"><button class="icon-btn" title="Editar" onclick="openProductForm('${p.id}')">✎</button><button class="icon-btn danger" title="Excluir" onclick="deleteProduct('${p.id}')">⌫</button></div></td></tr>`).join('')}</tbody></table>${!list.length?`<div class="empty catalog-empty"><div class="empty-icon">📦</div><b>${state.products.length?'Nenhum produto encontrado.':'Catálogo vazio.'}</b><span>${state.products.length?'Tente outro termo de busca.':'Cadastre os produtos manualmente para começar.'}</span>${state.products.length?'':'<button class="btn btn-primary" onclick="openProductForm()">+ Cadastrar primeiro produto</button>'}</div>`:''}</div>`;
}
function openProductForm(id=null){ state.editing=id===null?'new':String(id); render(); setTimeout(()=>$('.product-form')?.scrollIntoView({behavior:'smooth',block:'start'}),20); }
function lockCheck(id,label,on){return `<label class="protection-option"><input id="${id}" type="checkbox" ${on?'checked':''}><span><b>${label}</b><small>Não sobrescrever nas importações.</small></span></label>`}
function productForm(){
  const p=state.editing==='new'?{code:'',ean:'',name:'',brand:'',category:'Outros',unit:'',price:'',stock:'',entry_date:'',lot:'',expiry_date:'',icon:'📦',image_url:'',lock_name:false,lock_brand:false,lock_category:false,lock_unit:false,lock_price:false,lock_image:false}:state.products.find(x=>sameId(x.id,state.editing));
  if(!p){ state.editing=null; return '<div class="panel empty">Produto não encontrado.</div>'; }
  return `<div class="panel product-form clean-product-form">
    <div class="clean-form-head"><div><span class="eyebrow">${state.editing==='new'?'NOVO PRODUTO':'EDIÇÃO DE PRODUTO'}</span><h2>${state.editing==='new'?'Cadastrar produto':'Editar produto'}</h2><p>Dados do catálogo à esquerda; operação e proteções à direita.</p></div><button class="clean-close" title="Fechar" onclick="closeProductForm()">✕</button></div>
    <div class="clean-form-body"><div class="clean-main-column">
      <section class="clean-card"><div class="clean-card-title"><div><h3>Informações do catálogo</h3><p>O que o associado verá.</p></div></div><div class="clean-fields clean-fields-main">
        <div class="field"><label>Código <em>*</em></label><input id="f_code" value="${esc(p.code)}"></div>
        <div class="field"><label>EAN / código de barras</label><input id="f_ean" placeholder="7891234567890" value="${esc(p.ean||'')}"></div>
        <div class="field clean-span-2"><label>Produto <em>*</em></label><input id="f_name" value="${esc(p.name)}"></div>
        <div class="field"><label>Marca <em>*</em></label><input id="f_brand" value="${esc(p.brand)}"></div>
        <div class="field"><label>Categoria <em>*</em></label><input id="f_category" list="category-list" value="${esc(p.category)}"><datalist id="category-list">${categories().map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
        <div class="field"><label>Unidade / gramagem <em>*</em></label><input id="f_unit" placeholder="Ex.: 500g / Caixa c/ 12" value="${esc(p.unit)}"></div>
        <div class="field"><label>Preço de venda</label><div class="money-input"><span>R$</span><input id="f_price" inputmode="decimal" type="number" step="0.01" min="0" value="${p.price}"></div></div>
      </div></section>
      <section class="clean-card"><div class="clean-card-title"><div><h3>Imagem do produto</h3><p>Opcional. Use uma URL pública ou um ícone de reserva.</p></div></div><div class="clean-image-row"><div class="field clean-image-url"><label>URL da foto</label><input id="f_image" placeholder="https://..." value="${esc(p.image_url||'')}"></div><div class="field clean-icon-field"><label>Ícone</label><input id="f_icon" maxlength="4" value="${esc(p.icon||'📦')}"></div></div></section>
      ${state.editing!=='new'&&p.sysmo_name?`<section class="clean-card sysmo-clean-card"><div class="clean-card-title"><div><h3>Referência do Sysmo</h3><p>Somente para conferência.</p></div><span class="sysmo-tag">SYS</span></div><div class="sysmo-clean-content"><b>${esc(p.sysmo_name)}</b><span>${esc(p.sysmo_brand||'Sem marca')}</span><span>${p.sysmo_unit_cost!=null?'Custo estimado: '+money(p.sysmo_unit_cost):'Custo não informado'}</span></div></section>`:''}
    </div><aside class="clean-side-column">
      <section class="clean-card stock-clean-card"><div class="clean-card-title"><div><h3>Estoque e rastreabilidade</h3><p>Dados operacionais.</p></div><span class="stock-sync-badge">↻ Sysmo</span></div><div class="clean-fields clean-fields-side"><div class="field"><label>Quantidade</label><input id="f_stock" type="number" step="0.001" min="0" value="${p.stock}"><small class="field-help">A próxima importação do Sysmo atualiza este saldo.</small></div><div class="field"><label>Data de entrada</label><input id="f_entry" type="date" value="${p.entry_date||''}"></div><div class="field"><label>Lote</label><input id="f_lot" placeholder="Informe o lote" value="${esc(p.lot||'')}"></div><div class="field"><label>Validade</label><input id="f_expiry" type="date" value="${p.expiry_date||''}"></div></div></section>
      <details class="clean-card protection-card"><summary><span><b>Proteções contra importação</b><small>Escolha o que deve permanecer manual.</small></span><span class="summary-chevron">⌄</span></summary><div class="protection-options">${lockCheck('f_lock_name','Nome do produto',p.lock_name)}${lockCheck('f_lock_brand','Marca',p.lock_brand)}${lockCheck('f_lock_category','Categoria',p.lock_category)}${lockCheck('f_lock_unit','Unidade / gramagem',p.lock_unit)}${lockCheck('f_lock_price','Preço de venda',p.lock_price)}${lockCheck('f_lock_image','Imagem',p.lock_image)}</div></details>
    </aside></div>
    <div class="clean-form-actions"><button class="btn btn-light" onclick="closeProductForm()">Cancelar</button><button class="btn btn-primary" onclick="saveProduct()">Salvar produto</button></div>
  </div>`;
}
function closeProductForm(){state.editing=null;render()}
async function saveProduct(){
  const b={code:val('f_code').trim(),ean:val('f_ean').trim(),name:val('f_name').trim(),brand:val('f_brand').trim(),category:val('f_category').trim(),unit:val('f_unit').trim(),price:val('f_price'),stock:val('f_stock'),entry_date:val('f_entry')||null,lot:val('f_lot').trim(),expiry_date:val('f_expiry')||null,image_url:val('f_image').trim(),icon:val('f_icon').trim()||'📦',lock_name:checked('f_lock_name'),lock_brand:checked('f_lock_brand'),lock_category:checked('f_lock_category'),lock_unit:checked('f_lock_unit'),lock_price:checked('f_lock_price'),lock_image:checked('f_lock_image')};
  if(!b.code||!b.name||!b.brand||!b.category||!b.unit)return toast('Preencha os campos obrigatórios do produto.',true);
  try{setBusy(true); if(state.editing==='new')await api('/api/products',{method:'POST',body:JSON.stringify(b)});else await api(`/api/products/${state.editing}`,{method:'PUT',body:JSON.stringify(b)}); state.editing=null; await refreshData(); toast('Produto salvo.'); render();}catch(e){toast(e.message,true)}finally{setBusy(false)}
}
async function deleteProduct(id){
  const p=state.products.find(x=>sameId(x.id,id)); if(!p)return;
  if(!confirm(`Excluir "${p.name}" do catálogo? Pedidos antigos continuarão preservados.`))return;
  try{await api(`/api/products/${p.id}`,{method:'DELETE'});await refreshData();toast('Produto excluído do catálogo.');render()}catch(e){toast(e.message,true)}
}
async function clearProductCatalog(){
  const total=state.products.length;if(!total)return toast('O catálogo já está vazio.');
  if(!confirm(`Você está prestes a remover ${total} produto${total===1?'':'s'} do catálogo. Pedidos, usuários e associados serão preservados. Continuar?`))return;
  const typed=prompt('Para confirmar a limpeza completa, digite EXCLUIR:','');
  if(String(typed||'').trim().toUpperCase()!=='EXCLUIR')return toast('Limpeza cancelada.');
  try{setBusy(true);const d=await api('/api/products',{method:'DELETE'});state.cart=[];saveCart();state.editing=null;state.search='';state.category='Todos';await refreshData();toast(`${d.total||total} produtos removidos do catálogo.`);render()}catch(e){toast(e.message,true)}finally{setBusy(false)}
}

function cart(){
  const total=state.cart.reduce((s,x)=>s+Number(x.price)*Number(x.qty),0);
  return `${pageTitle('SEU PEDIDO','Meu carrinho','Revise quantidades e valores antes de enviar.',`<button class="btn btn-light" onclick="setView('products')">← Continuar comprando</button>`)}
  <div class="cart-layout"><div class="panel cart-panel">${state.cart.length?state.cart.map(x=>`<div class="cart-row"><div class="cart-product"><div class="cart-thumb">${x.image_url?`<img src="${esc(x.image_url)}" alt="">`:esc(x.icon||'📦')}</div><div><b>${esc(x.name)}</b><small>${esc(x.unit)}</small></div></div><div class="cart-unit-price">${Number(x.price)>0?money(x.price):'<span class="pending-price">Sob consulta</span>'}</div><div class="qty-control"><button aria-label="Diminuir" onclick="changeQty('${x.id}',-1)">−</button><b>${x.qty}</b><button aria-label="Aumentar" onclick="changeQty('${x.id}',1)">+</button></div><b>${Number(x.price)>0?money(Number(x.price)*Number(x.qty)):'A confirmar'}</b><button class="icon-btn danger" title="Remover" onclick="removeCart('${x.id}')">⌫</button></div>`).join(''):'<div class="empty"><div class="empty-icon">🛒</div><b>Seu carrinho está vazio.</b><span>Adicione produtos para montar o pedido.</span><button class="btn btn-primary" onclick="setView(\'products\')">Ir para produtos</button></div>'}</div>
  <aside class="panel summary-box"><h3>Resumo do pedido</h3><div class="summary-line"><span>Itens</span><b>${state.cart.reduce((s,x)=>s+Number(x.qty),0)}</b></div><div class="summary-line"><span>Total conhecido</span><b>${money(total)}</b></div>${state.cart.some(x=>Number(x.price)<=0)?'<div class="summary-warning">Há itens com preço sob consulta. A central confirma esses valores.</div>':''}<div class="summary-total"><span>Total</span><b>${state.cart.some(x=>Number(x.price)<=0)?'A confirmar':money(total)}</b></div><button class="btn btn-primary full" onclick="finishOrder()" ${!state.cart.length?'disabled':''}>Enviar pedido →</button><p class="summary-note">Ao enviar, o estoque é reservado automaticamente.</p></aside></div>`;
}
function changeQty(id,d){const x=state.cart.find(i=>sameId(i.id,id));if(!x)return;const p=state.products.find(i=>sameId(i.id,id));const max=Math.floor(Number(p?.stock??x.stock??0));if(max<=0){removeCart(id);return toast('Produto ficou sem estoque e foi removido.',true)}x.qty=Math.max(1,Math.min(max,Number(x.qty)+d));saveCart();render()}
function removeCart(id){state.cart=state.cart.filter(x=>!sameId(x.id,id));saveCart();render()}
async function finishOrder(){
  if(!state.cart.length)return; if(!confirm('Enviar este pedido para a central?'))return;
  try{setBusy(true);const d=await api('/api/orders',{method:'POST',body:JSON.stringify({items:state.cart.map(x=>({product_id:x.id,quantity:x.qty}))})});state.cart=[];saveCart();await refreshData();state.view='orders';toast(`Pedido #${d.order_id} enviado.`);render()}catch(e){toast(e.message,true);await refreshData();render()}finally{setBusy(false)}
}
function badge(st){const cls=st==='Entregue'?'green':st==='Cancelado'?'red':st==='Pronto'?'blue':st==='Separando'?'yellow':'purple';return `<span class="pill ${cls}">${esc(st)}</span>`}
function orders(){return state.user.role==='admin'?adminOrders():associateOrders()}
function associateOrders(){return `${pageTitle('HISTÓRICO','Meus pedidos','Acompanhe a situação e confira os itens enviados.')}<div class="orders-list">${state.orders.length?state.orders.map(orderCard).join(''):'<div class="panel empty">Nenhum pedido realizado ainda.</div>'}</div>`}
function orderCard(o){const open=sameId(state.orderOpen,o.id);return `<article class="panel order-card ${open?'open':''}"><div><span class="order-number">#${o.id}</span><small>${dateTimeBR(o.created_at)}</small></div><div>${badge(o.status)}</div><div><small>Total</small><b>${money(o.total)}</b></div><button class="btn btn-light" onclick="toggleOrder('${o.id}')">${open?'Ocultar itens':'Ver itens'}</button><div class="order-items ${open?'':'hidden'}">${o.items.map(i=>`<div><span>${i.quantity}x ${esc(i.name)} <small>${esc(i.unit||'')}</small></span><b>${money(Number(i.unit_price)*Number(i.quantity))}</b></div>`).join('')}</div></article>`}
function toggleOrder(id){state.orderOpen=sameId(state.orderOpen,id)?null:String(id);render()}
function adminOrders(){return `${pageTitle('OPERAÇÃO','Pedidos dos associados','Acompanhe os itens e atualize o andamento de cada pedido.')} ${orderTable(state.orders,true,false)}`}
function orderTable(list,admin=false,compact=false){
  return `<div class="panel table-wrap ${compact?'compact-table':''}"><table class="table"><thead><tr><th>Pedido</th><th>Associado</th><th>Data</th><th>Status</th><th>Itens</th><th>Total</th>${admin?'<th>Atualizar</th>':''}<th>Detalhes</th></tr></thead><tbody>${list.map(o=>`<tr><td data-label="Pedido"><b>#${o.id}</b></td><td data-label="Associado">${esc(o.associate_name)}</td><td data-label="Data">${dateTimeBR(o.created_at)}</td><td data-label="Status">${badge(o.status)}</td><td data-label="Itens">${o.items.reduce((s,i)=>s+Number(i.quantity),0)}</td><td data-label="Total"><b>${money(o.total)}</b></td>${admin?`<td data-label="Atualizar"><select class="status-select" onchange="updateStatus('${o.id}',this.value,this)" ${state.busy?'disabled':''}>${['Recebido','Separando','Pronto','Entregue','Cancelado'].map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}</select></td>`:''}<td data-label="Detalhes"><button class="icon-btn" title="Ver itens" onclick="openOrderDetails('${o.id}')">⌄</button></td></tr>${sameId(state.orderOpen,o.id)?`<tr class="detail-row"><td colspan="${admin?8:7}"><div class="table-order-items">${o.items.map(i=>`<div><span><b>${i.quantity}x</b> ${esc(i.name)} <small>${esc(i.code||'')}</small></span><span>${money(i.unit_price)} un.</span><b>${money(Number(i.unit_price)*Number(i.quantity))}</b></div>`).join('')}</div></td></tr>`:''}`).join('')}</tbody></table>${!list.length?'<div class="empty">Nenhum pedido encontrado.</div>':''}</div>`;
}
function openOrderDetails(id){state.orderOpen=sameId(state.orderOpen,id)?null:String(id);render()}
async function updateStatus(id,status,select){
  const old=state.orders.find(o=>sameId(o.id,id))?.status;
  try{select.disabled=true;await api(`/api/orders/${id}/status`,{method:'PUT',body:JSON.stringify({status})});await refreshData();toast('Status atualizado.');render()}catch(e){toast(e.message,true);if(select){select.value=old||'Recebido';select.disabled=false}}
}

function associates(){
  return `${pageTitle('REDE','Associados','Empresas autorizadas a comprar pelo portal.',`<button class="btn btn-primary" onclick="openAssociateForm()">+ Novo associado</button>`)}${state.editingAssociate!==null?associateForm():''}
  <div class="panel table-wrap"><table class="table"><thead><tr><th>Associado</th><th>CNPJ</th><th>Contato</th><th>Usuários</th><th>Status</th><th>Ações</th></tr></thead><tbody>${state.associates.map(a=>`<tr><td data-label="Associado"><b>${esc(a.trade_name)}</b><small>${esc(a.corporate_name)}</small></td><td data-label="CNPJ">${esc(a.cnpj)}</td><td data-label="Contato">${esc(a.phone||'—')}<small>${esc(a.email||'')}</small></td><td data-label="Usuários">${a.user_count}</td><td data-label="Status"><span class="pill ${a.active?'green':'red'}">${a.active?'Ativo':'Inativo'}</span></td><td data-label="Ações"><div class="row-actions"><button class="icon-btn" title="Editar" onclick="openAssociateForm('${a.id}')">✎</button>${a.active?`<button class="icon-btn danger" title="Desativar" onclick="deleteAssociate('${a.id}')">⌫</button>`:''}</div></td></tr>`).join('')}</tbody></table>${!state.associates.length?'<div class="empty">Nenhum associado cadastrado.</div>':''}</div>`;
}
function openAssociateForm(id=null){state.editingAssociate=id===null?'new':String(id);render();setTimeout(()=>$('.entity-form')?.scrollIntoView({behavior:'smooth',block:'start'}),20)}
function associateForm(){
  const a=state.editingAssociate==='new'?{corporate_name:'',trade_name:'',cnpj:'',phone:'',email:'',active:true}:state.associates.find(x=>sameId(x.id,state.editingAssociate)); if(!a)return '';
  return `<div class="panel entity-form"><div class="form-head"><div><span class="eyebrow">${state.editingAssociate==='new'?'NOVO ASSOCIADO':'EDIÇÃO'}</span><h2>${state.editingAssociate==='new'?'Cadastrar associado':'Editar associado'}</h2><p>Dados da empresa vinculada aos compradores.</p></div><button class="clean-close" onclick="state.editingAssociate=null;render()">✕</button></div><div class="form-grid"><div class="field span2"><label>Razão social *</label><input id="a_corporate" value="${esc(a.corporate_name)}"></div><div class="field"><label>Nome fantasia *</label><input id="a_trade" value="${esc(a.trade_name)}"></div><div class="field"><label>CNPJ *</label><input id="a_cnpj" value="${esc(a.cnpj)}"></div><div class="field"><label>Telefone</label><input id="a_phone" value="${esc(a.phone||'')}"></div><div class="field"><label>E-mail</label><input id="a_email" type="email" value="${esc(a.email||'')}"></div>${state.editingAssociate!=='new'?`<div class="field"><label>Status</label><select id="a_active"><option value="1" ${a.active?'selected':''}>Ativo</option><option value="0" ${!a.active?'selected':''}>Inativo</option></select></div>`:''}</div><div class="form-actions"><button class="btn btn-light" onclick="state.editingAssociate=null;render()">Cancelar</button><button class="btn btn-primary" onclick="saveAssociate()">Salvar associado</button></div></div>`;
}
async function saveAssociate(){const b={corporate_name:val('a_corporate').trim(),trade_name:val('a_trade').trim(),cnpj:val('a_cnpj').trim(),phone:val('a_phone').trim(),email:val('a_email').trim(),active:byId('a_active')?Number(val('a_active')):1};if(!b.corporate_name||!b.trade_name||!b.cnpj)return toast('Razão social, nome fantasia e CNPJ são obrigatórios.',true);try{if(state.editingAssociate==='new')await api('/api/associates',{method:'POST',body:JSON.stringify(b)});else await api(`/api/associates/${state.editingAssociate}`,{method:'PUT',body:JSON.stringify(b)});state.editingAssociate=null;await refreshData();toast('Associado salvo.');render()}catch(e){toast(e.message,true)}}
async function deleteAssociate(id){const a=state.associates.find(x=>sameId(x.id,id));if(!a)return;if(!confirm(`Desativar ${a.trade_name} e seus usuários?`))return;try{await api(`/api/associates/${id}`,{method:'DELETE'});await refreshData();toast('Associado desativado.');render()}catch(e){toast(e.message,true)}}

function users(){
  return `${pageTitle('ACESSOS','Usuários','Crie logins individuais e vincule compradores aos associados.',`<button class="btn btn-primary" onclick="openUserForm()">+ Novo usuário</button>`)}${state.editingUser!==null?userForm():''}
  <div class="panel table-wrap"><table class="table"><thead><tr><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Associado</th><th>Status</th><th>Ações</th></tr></thead><tbody>${state.users.map(u=>`<tr><td data-label="Usuário"><b>${esc(u.name)}</b></td><td data-label="E-mail">${esc(u.email)}</td><td data-label="Perfil">${u.role==='admin'?'Administrador':'Associado'}</td><td data-label="Associado">${esc(u.associate_name||'—')}</td><td data-label="Status"><span class="pill ${u.active?'green':'red'}">${u.active?'Ativo':'Inativo'}</span></td><td data-label="Ações"><div class="row-actions"><button class="icon-btn" title="Editar" onclick="openUserForm('${u.id}')">✎</button><button class="icon-btn danger" title="Excluir usuário" onclick="deleteUser('${u.id}')" ${sameId(u.id,state.user.id)?'disabled':''}>⌫</button></div></td></tr>`).join('')}</tbody></table>${!state.users.length?'<div class="empty">Nenhum usuário cadastrado.</div>':''}</div>`;
}
function openUserForm(id=null){state.editingUser=id===null?'new':String(id);render();setTimeout(()=>$('.entity-form')?.scrollIntoView({behavior:'smooth',block:'start'}),20)}
function userForm(){
  const u=state.editingUser==='new'?{name:'',email:'',role:'associate',associate_id:'',active:true}:state.users.find(x=>sameId(x.id,state.editingUser)); if(!u)return '';
  return `<div class="panel entity-form"><div class="form-head"><div><span class="eyebrow">${state.editingUser==='new'?'NOVO USUÁRIO':'EDIÇÃO'}</span><h2>${state.editingUser==='new'?'Criar usuário':'Editar usuário'}</h2><p>${state.editingUser==='new'?'Defina o acesso ao portal.':'Deixe a senha vazia para manter a atual.'}</p></div><button class="clean-close" onclick="state.editingUser=null;render()">✕</button></div><div class="form-grid"><div class="field"><label>Nome *</label><input id="u_name" value="${esc(u.name)}"></div><div class="field"><label>E-mail *</label><input id="u_email" type="email" value="${esc(u.email)}"></div><div class="field"><label>Perfil</label><select id="u_role" onchange="renderUserAssoc()"><option value="associate" ${u.role==='associate'?'selected':''}>Associado</option><option value="admin" ${u.role==='admin'?'selected':''}>Administrador</option></select></div><div class="field" id="user-assoc-holder">${u.role==='associate'?userAssocSelect(u.associate_id):'<label>Associado</label><div class="disabled-field">Não se aplica</div>'}</div><div class="field"><label>Senha ${state.editingUser==='new'?'*':'(opcional)'}</label><input id="u_password" type="password" autocomplete="new-password" placeholder="${state.editingUser==='new'?'Mínimo 8 caracteres':'Deixe vazio para manter'}"></div>${state.editingUser!=='new'?`<div class="field"><label>Status</label><select id="u_active"><option value="1" ${u.active?'selected':''}>Ativo</option><option value="0" ${!u.active?'selected':''}>Inativo</option></select></div>`:''}</div><div class="form-actions"><button class="btn btn-light" onclick="state.editingUser=null;render()">Cancelar</button><button class="btn btn-primary" onclick="saveUser()">Salvar usuário</button></div></div>`;
}
function userAssocSelect(selected){return `<label>Associado *</label><select id="u_associate"><option value="">Selecione...</option>${state.associates.filter(a=>a.active).map(a=>`<option value="${a.id}" ${sameId(selected,a.id)?'selected':''}>${esc(a.trade_name)}</option>`).join('')}</select>`}
function renderUserAssoc(){const holder=byId('user-assoc-holder');if(!holder)return;holder.innerHTML=val('u_role')==='associate'?userAssocSelect(state.editingUser==='new'?'':state.users.find(x=>sameId(x.id,state.editingUser))?.associate_id):'<label>Associado</label><div class="disabled-field">Não se aplica</div>'}
async function saveUser(){const b={name:val('u_name').trim(),email:val('u_email').trim(),role:val('u_role'),associate_id:val('u_associate')||null,password:val('u_password'),active:byId('u_active')?Number(val('u_active')):1};if(!b.name||!b.email)return toast('Nome e e-mail são obrigatórios.',true);if(state.editingUser==='new'&&b.password.length<8)return toast('A senha deve ter pelo menos 8 caracteres.',true);if(b.role==='associate'&&!b.associate_id)return toast('Selecione o associado.',true);try{if(state.editingUser==='new')await api('/api/users',{method:'POST',body:JSON.stringify(b)});else await api(`/api/users/${state.editingUser}`,{method:'PUT',body:JSON.stringify(b)});state.editingUser=null;await refreshData();toast('Usuário salvo.');render()}catch(e){toast(e.message,true)}}
async function deleteUser(id){
  const u=state.users.find(x=>sameId(x.id,id));
  if(!u)return toast('Usuário não encontrado.',true);
  if(sameId(u.id,state.user.id))return toast('Você não pode excluir o próprio usuário.',true);
  if(!confirm(`Excluir o usuário ${u.name}? O histórico de pedidos será preservado.`))return;
  try{
    setBusy(true);
    await api(`/api/users/${id}`,{method:'DELETE'});
    if(sameId(state.editingUser,id))state.editingUser=null;
    await refreshData();
    toast('Usuário excluído.');
    render();
  }catch(e){toast(e.message,true)}finally{setBusy(false)}
}

function importPage(){return `${pageTitle('IMPORTAÇÃO EM MASSA','Importar estoque do Sysmo','Envie o CSV “Análise do Estoque por Marca/Produto”.',`<a class="btn btn-light download-link" href="modelo-importacao.csv" download>↓ Modelo CSV</a>`)}
<div class="import-grid"><section class="panel import-info"><h2>Como funciona</h2><p>O portal reconhece o relatório do Sysmo e usa o <b>código</b> como identificação do item.</p><div class="import-note"><b>Importante:</b> o estoque é atualizado pelo Sysmo. Campos protegidos permanecem manuais e o preço de venda não é substituído pelo valor de margem zero.</div><div class="sysmo-rules"><div><span>✓</span>Código identifica o produto</div><div><span>✓</span>Quantidade atualiza o estoque</div><div><span>✓</span>Margem zero fica só como referência</div><div><span>✓</span>Produto novo entra com preço R$ 0,00</div></div></section>
<section class="panel upload-panel"><h2>Arquivo de estoque</h2><label class="file-drop" for="csv_file"><span>⇧</span><b>Escolher arquivo CSV</b><small>Relatório do Sysmo ou modelo padrão</small></label><input id="csv_file" class="sr-only" type="file" accept=".csv,text/csv" onchange="previewCSV(this.files[0])"><div id="csv_preview" class="csv-preview"><div class="empty compact">Nenhum arquivo selecionado.</div></div><button id="import_btn" class="btn btn-primary full" onclick="sendImport()" disabled>Importar para o sistema</button></section></div>`}
let importRows=[], importSource='standard';
const brNumber=v=>{const s=String(v??'').trim();if(!s)return '';return Number(s.replace(/\./g,'').replace(',','.'))||0};
function parseLine(line){let a=[],cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(ch===';'&&!q){a.push(cur.trim());cur=''}else cur+=ch}a.push(cur.trim());return a}
function looksLikeSysmo(text){return /An[aá]lise do Estoque por Marca\/Produto/i.test(text)||/Pr[çc]\. mrg\. zero/i.test(text)||/MARCA:\s*\d+/i.test(text)}
function parseSysmoCSV(text){let brand='Sem marca',rows=[];for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line)continue;const nonEmpty=parseLine(line).filter(v=>v!=='');if(!nonEmpty.length)continue;if(/^MARCA:/i.test(nonEmpty[0])){const m=nonEmpty[0].match(/^MARCA:\s*\d+\s*-\s*(.+)$/i);brand=m?m[1].trim():nonEmpty[0].replace(/^MARCA:\s*/i,'').trim();continue}if(nonEmpty.length<3)continue;const [name,code,qty,total]=nonEmpty;if(!/^\d+$/.test(code||'')||!/-?[\d.,]+/.test(qty||''))continue;rows.push({code,name,brand,stock:brNumber(qty),sysmo_total_value:total==null||total===''?'':brNumber(total)})}return rows}
function parseStandardCSV(text){const first=(text.split(/\r?\n/)[0]||'');const sep=(first.match(/;/g)||[]).length>=(first.match(/,/g)||[]).length?';':',';const lines=text.split(/\r?\n/).filter(x=>x.trim());const parse=line=>{let a=[],cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(ch===sep&&!q){a.push(cur.trim());cur=''}else cur+=ch}a.push(cur.trim());return a};const head=parse(lines.shift()||'').map(x=>x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_'));const map={codigo:'code',code:'code',ean:'ean',produto:'name',nome:'name',name:'name',marca:'brand',brand:'brand',categoria:'category',category:'category',unidade:'unit',embalagem:'unit',unit:'unit',preco:'price',price:'price',estoque:'stock',stock:'stock',data_entrada:'entry_date',entrada:'entry_date',lote:'lot',validade:'expiry_date',imagem_url:'image_url',foto:'image_url'};return lines.map(line=>{const cols=parse(line),o={};head.forEach((h,i)=>{if(map[h])o[map[h]]=cols[i]??''});if(o.price)o.price=String(o.price).replace(',','.');return o}).filter(x=>x.code||x.name)}
function readCSVFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=reject;r.readAsText(file,'windows-1252')})}
async function previewCSV(file){if(!file)return;try{const text=await readCSVFile(file);importSource=looksLikeSysmo(text)?'sysmo':'standard';importRows=importSource==='sysmo'?parseSysmoCSV(text):parseStandardCSV(text);const box=byId('csv_preview');if(!importRows.length){box.innerHTML='<div class="empty compact">Nenhum produto válido encontrado.</div>';byId('import_btn').disabled=true;return}box.innerHTML=`<div class="preview-ok"><b>${importRows.length} produtos encontrados</b><span>${importSource==='sysmo'?'✓ Relatório Sysmo reconhecido':'CSV padrão'}</span></div><div class="mini-table">${importRows.slice(0,5).map(r=>`<div><b>${esc(r.code||'—')}</b><span>${esc(r.name||'Sem nome')}</span><span>${qtyBR(r.stock||0)}</span></div>`).join('')}</div>${importRows.length>5?`<small class="preview-more">+ ${importRows.length-5} produtos no arquivo</small>`:''}`;byId('import_btn').disabled=false}catch(e){console.error(e);toast('Não foi possível ler o CSV.',true)}}
async function sendImport(){if(!importRows.length)return;const btn=byId('import_btn');btn.disabled=true;btn.textContent='Importando...';try{const d=await api('/api/products/import',{method:'POST',body:JSON.stringify({rows:importRows,source:importSource})});await refreshData();importRows=[];toast(`${d.created} criados e ${d.updated} atualizados.`);byId('csv_preview').innerHTML=`<div class="import-success">✓ Importação concluída<br><b>${d.created}</b> novos · <b>${d.updated}</b> atualizados${d.reviewPrice?`<br><b>${d.reviewPrice}</b> precisam de preço`:''}${d.errors?.length?`<br><small>${d.errors.length} linhas com erro</small>`:''}</div>`;btn.textContent='Importação concluída'}catch(e){toast(e.message,true);btn.disabled=false;btn.textContent='Importar para o sistema'}}

function render(){const content=!state.user?loginPage():layout(state.view==='dashboard'?dashboard():state.view==='products'?products():state.view==='cart'?cart():state.view==='orders'?orders():state.view==='associates'?associates():state.view==='users'?users():state.view==='import'?importPage():dashboard());byId('app').innerHTML=content;document.body.classList.toggle('admin-mode',state.user?.role==='admin')}
boot();
