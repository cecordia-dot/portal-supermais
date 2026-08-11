REDE SUPER MAIS - PORTAL DE COMPRAS MVP v5

O QUE MUDOU
- Banco migrado de SQLite para PostgreSQL.
- Sessões agora ficam no banco e sobrevivem a reinícios do servidor.
- Preparado para hospedagem pública com variável DATABASE_URL.
- Dockerfile e docker-compose incluídos.
- Endpoint de saúde: /api/health
- Senha mínima de 8 caracteres para novos usuários.
- Histórico de pedidos do associado é compartilhado entre usuários do mesmo mercado.

TESTE LOCAL MAIS FÁCIL (COM DOCKER)
1. Instale Docker Desktop.
2. Extraia a pasta.
3. Abra um terminal dentro da pasta.
4. Antes do primeiro uso, troque as senhas do docker-compose.yml.
5. Execute: docker compose up --build
6. Abra: http://localhost:3000

TESTE LOCAL SEM DOCKER
1. Instale Node.js 22.5+ e PostgreSQL.
2. Crie um banco PostgreSQL.
3. Copie .env.example para .env e ajuste DATABASE_URL.
4. Exporte as variáveis do .env no seu terminal/sistema.
5. Execute: npm install
6. Execute: npm start

IMPORTANTE PARA PRODUÇÃO
- Nunca publique usando as senhas de exemplo.
- Configure DATABASE_URL no provedor de hospedagem.
- Use HTTPS e domínio próprio.
- Faça backup automático do PostgreSQL.
- Remova ou altere as credenciais de demonstração antes de liberar aos associados.
- O primeiro deploy cria as tabelas e dados de demonstração automaticamente.

ACESSOS DE DEMONSTRAÇÃO
Administrador: admin@supermais.com
Associado: mercado@supermais.com
As senhas são definidas por SEED_ADMIN_PASSWORD e SEED_ASSOCIATE_PASSWORD no primeiro deploy.


MVP 6 — INTEGRAÇÃO SYSMO
========================
- Aceita diretamente o relatório CSV “Análise do Estoque por Marca/Produto” do Sysmo.
- Reconhece MARCA, Código, Quantidade e “Prç. mrg. zero”.
- O estoque é sempre atualizado pelo Sysmo.
- “Prç. mrg. zero” é armazenado apenas como referência de custo; NÃO substitui o preço de venda.
- Produtos novos entram com preço R$ 0,00 para revisão.
- No cadastro do produto, o administrador pode proteger Nome, Marca, Categoria, Unidade/gramagem, Preço e Foto.
- Campos protegidos não são sobrescritos em importações futuras.
