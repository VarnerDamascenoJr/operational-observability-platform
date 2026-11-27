# Indisponibilidade temporaria do Collector

`npm run test:collector-outage` executa um cenario local isolado. Sao necessarios
Docker Compose, Node.js, dependencias instaladas, `curl` e `jq`. O teste cria um
projeto Compose temporario com portas locais aleatorias, sua propria rede,
Collector, Tempo e Loki. Ele nao para ou altera a stack principal. Os containers
e a rede do teste sao removidos ao terminar, inclusive em caso de falha; nesse
caso os logs do teste sao exibidos.

O teste inicia uma instancia isolada da aplicacao usando o exportador OTLP HTTP
real, sem PostgreSQL. Primeiro confirma que um trace lento e seu log chegam ao
Tempo e ao Loki. Depois para apenas o Collector do teste e verifica que:

- uma transacao bem-sucedida continua respondendo com sucesso;
- uma falha simulada da dependencia continua retornando 503;
- o log local registra a falha de exportacao OTLP.

Apos reiniciar o Collector, verifica que novos traces lentos e logs voltam a
chegar e que o trace enviado durante a indisponibilidade nao foi reenviado. O
exportador demonstrativo atual tenta uma vez, com timeout de um segundo, e nao
possui fila de retry. Portanto, a resposta da transacao pode aguardar o timeout e
telemetria pode ser perdida. Isso descreve o modulo demonstrativo, nao o
comportamento de todos os produtores OTLP ou de todas as falhas de rede.

O teste usa traces lentos para corresponder a politica de sampling. Ele nao
mede perda sob carga, atraso ou capacidade de recuperacao, nem testa interrupcao
do PostgreSQL; esses cenarios permanecem no backlog.
