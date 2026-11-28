# Indisponibilidade temporaria do PostgreSQL

`npm run test:postgres-outage` cria uma instancia PostgreSQL e uma API de teste
em um projeto Compose isolado, com portas locais escolhidas para a execucao.
Requer Docker Compose, Node.js, dependencias instaladas, `curl`, `jq` e o
comando `timeout` do GNU coreutils. O teste para apenas o banco que criou e
remove os containers, a rede e o volume descartavel desse projeto ao terminar.
Ele nao usa ou altera o banco da stack principal.

O teste salva uma politica de sampling, interrompe o banco e verifica que:

- erros em conexoes ociosas sao registrados sem encerrar a API;
- `/health` retorna 503 com PostgreSQL em erro e estado geral degradado;
- leituras e escritas da politica de sampling retornam 500;
- a transacao demonstrativa e as metricas HTTP continuam acessiveis; metricas
  de SLO dependentes do banco podem estar ausentes;
- uma nova instancia da API nao inicia enquanto as migrations nao conseguem
  conectar ao PostgreSQL.

Depois de reiniciar o banco, o teste confirma que a mesma API volta a ficar
saudavel, a configuracao salva continua intacta, a escrita que falhou nao foi
aplicada e uma nova escrita funciona. O cenario cobre uma interrupcao local com
conexao recusada; ele nao caracteriza particoes de rede, lentidao prolongada,
transacoes em andamento ou disponibilidade sob carga.
