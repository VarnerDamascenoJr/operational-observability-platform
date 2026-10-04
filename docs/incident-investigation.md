# Incidentes e investigacao guiada

A API de incidentes transforma alertas baseados em sintomas em uma investigacao
persistida. O objetivo e manter em um unico lugar o sintoma, as evidencias,
hipoteses, decisoes e encerramento.

## Abrir incidente

Use `POST /incidents` quando um alerta precisar virar investigacao.

```bash
curl --request POST http://localhost:3000/incidents \
  --header 'content-type: application/json' \
  --data '{
    "project": {
      "slug": "portfolio-observability",
      "name": "Portfolio Observability"
    },
    "service": {
      "slug": "operational-observability-platform",
      "name": "Operational Observability Platform",
      "environment": "local",
      "owner": "platform"
    },
    "sloId": "00000000-0000-4000-8000-000000000000",
    "title": "Demo transaction SLO burn",
    "summary": "The demo service spent its error budget.",
    "severity": "page",
    "sourceAlert": {
      "name": "OOPSloErrorBudgetBurn",
      "severity": "page",
      "fingerprint": "local-alert-fingerprint"
    },
    "evidence": [{
      "type": "dashboard",
      "title": "Business dashboard breach panel",
      "url": "http://localhost:3001/d/oop-demo-business"
    }],
    "hypotheses": [{
      "statement": "The dependency unavailable mode is driving user-visible failures.",
      "confidence": "medium"
    }]
  }'
```

`project` e `service` seguem o mesmo contrato da API de SLO. Quando `sloId` e
informado, ele precisa pertencer ao servico do incidente.

## Investigar

Use `PATCH /incidents/<incident-id>` para mover o incidente para
`investigating` ou `mitigated`. Use os endpoints abaixo para preservar contexto
sem misturar tudo no resumo:

- `POST /incidents/<incident-id>/evidence` para dashboards, traces, logs,
  runbooks, alertas e notas.
- `POST /incidents/<incident-id>/hypotheses` para registrar causas candidatas.
- `POST /incidents/<incident-id>/hypotheses/<hypothesis-id>/confidence` para
  ajustar a confianca numerica de uma hipotese com uma justificativa e,
  opcionalmente, uma evidencia associada.
- `POST /incidents/<incident-id>/timeline` para decisoes e observacoes
  ordenadas.

Estados aceitos:

- `open`
- `investigating`
- `mitigated`
- `resolved`

Um incidente `resolved` nao volta para estados ativos. Isso mantem o historico
de encerramento estavel.

### Confianca de hipoteses

Cada hipotese mantem a confianca qualitativa (`low`, `medium`, `high`) e um
`confidenceScore` de 0 a 1 usado para ranking. Ao abrir ou adicionar uma
hipotese, a confianca inicial vira score automaticamente:

- `low`: `0.25`
- `medium`: `0.5`
- `high`: `0.75`

Quando uma evidencia reforca ou enfraquece uma hipotese, envie um delta entre
`-1` e `1`:

```bash
curl --request POST \
  http://localhost:3000/incidents/<incident-id>/hypotheses/<hypothesis-id>/confidence \
  --header 'content-type: application/json' \
  --data '{
    "evidenceId": "00000000-0000-4000-8000-000000000000",
    "scoreDelta": 0.2,
    "reason": "Trace evidence points at the payment dependency."
  }'
```

A resposta do incidente inclui `confidenceHistory` em cada hipotese e
`hypothesisSummary`, com a hipotese ativa mais provavel e a incerteza restante.
Hipoteses rejeitadas ficam no historico, mas nao entram no resumo de ranking.

## Listar incidentes

Use `GET /incidents?limit=50` para listar incidentes em paginas, ordenados dos
mais recentes para os mais antigos. A resposta inclui `nextCursor` quando houver
mais registros:

```bash
curl 'http://localhost:3000/incidents?limit=50'
curl 'http://localhost:3000/incidents?limit=50&cursor=<nextCursor>'
```

`limit` aceita valores de `1` a `100` e usa `50` por padrao.

## Encerrar

Para encerrar, `rootCause` e `preventiveActions` sao obrigatorios:

```bash
curl --request PATCH http://localhost:3000/incidents/<incident-id> \
  --header 'content-type: application/json' \
  --data '{
    "status": "resolved",
    "rootCause": "Controlled unavailable dependency mode exhausted the demonstration SLO.",
    "preventiveActions": "Keep the dependency unavailable runbook linked from the alert."
  }'
```

O encerramento registra `resolvedAt` e adiciona um evento `resolved` na linha do
tempo.

## Roteiro de primeira resposta

1. Abra um incidente a partir do alerta de maior impacto, normalmente
   `OOPSloErrorBudgetBurn`.
2. Anexe o dashboard de negocio e o alerta tecnico relacionado.
3. Use Tempo e Loki para anexar trace e logs com o mesmo `trace_id`.
4. Registre uma hipotese inicial, mesmo que ela ainda esteja em baixa
   confianca.
5. Mova para `investigating`, depois `mitigated` quando houver mitigacao
   aplicada.
6. Encerre somente com causa raiz e acao preventiva registradas.
