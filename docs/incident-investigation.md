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
- `POST /incidents/<incident-id>/timeline` para decisoes e observacoes
  ordenadas.

Estados aceitos:

- `open`
- `investigating`
- `mitigated`
- `resolved`

Um incidente `resolved` nao volta para estados ativos. Isso mantem o historico
de encerramento estavel.

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
