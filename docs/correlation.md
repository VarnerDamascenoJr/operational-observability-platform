# Correlacao e logs estruturados

A plataforma usa tres identificadores com ciclos de vida diferentes:

| Campo            | Origem                               | Ciclo de vida                        |
| ---------------- | ------------------------------------ | ------------------------------------ |
| `request_id`     | `x-request-id` ou um UUID gerado     | Uma tentativa de requisicao HTTP     |
| `transaction_id` | `x-transaction-id` ou um UUID gerado | Uma jornada de negocio ponta a ponta |
| `trace_id`       | Span W3C/OpenTelemetry ativo         | Um trace distribuido                 |

IDs de request e transacao recebidos sao aceitos somente quando contem entre 1
e 128 letras ASCII, numeros, pontos, underscores, dois-pontos ou hifens. Valores
inseguros, duplicados ou grandes demais sao substituidos em vez de serem
registrados ou propagados. Valores aceitos e gerados sao retornados nos headers
HTTP correspondentes.

`request_id` deve acompanhar a cadeia sincrona de uma tentativa HTTP. Uma nova
tentativa normalmente recebe outro `request_id`. `transaction_id` deve ser
propagado em headers HTTP e metadados de mensagens assincronas enquanto a mesma
operacao de negocio estiver em andamento, inclusive em retries.

`trace_id` nao deve ser aceito por um header customizado `x-trace-id`. Ele sera
derivado do contexto OpenTelemetry ativo estabelecido pelo header padrao
`traceparent`. Enquanto o tracing da aplicacao nao estiver instrumentado, esse
campo sera omitido dos logs.

## Campos dos logs

Os logs da aplicacao sao JSON fora do modo local com pretty-print. Os campos da
aplicacao e de correlacao usam `snake_case`. Cada log de request inclui:

- `service_name`
- `environment`
- `request_id`
- `transaction_id`
- `trace_id` quando houver um span ativo
- `level`, `time` e `msg`

Eventos de negocio devem adicionar campos de dominio estaveis como `event_name`,
`transaction_id` e o ID da entidade relevante. Segredos, credenciais, payloads
completos e headers irrestritos nunca devem ser registrados.
