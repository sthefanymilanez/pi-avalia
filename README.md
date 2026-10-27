# PI AVALIA

Este diretório estava vazio (sem repositório ou aplicação existente). O conteúdo recebido descreve a aplicação completa; esta entrega estabelece uma base local executável para projetos e avaliação. Não representa ainda a conclusão de todos os fluxos institucionais descritos no prompt.

## Plano incremental

1. Criar a base da aplicação e implementar projetos, ficha versionada com os dez critérios, avaliações individuais, cálculo institucional 70/30 nas escalas 0–1 e 0–10 e modo banca móvel com rascunho automático.
2. Completar convites e permissões por projeto, armazenamento privado e ampliar as migrações conforme novos módulos forem adicionados.
3. Acrescentar relatórios PDF, exclusão controlada e consolidar médias da banca.
4. Conectar provedor de IA e serviços de similaridade somente após definir privacidade, fontes, limites e revisão humana.
5. Validar fluxos e documentar implantação.

## Estado desta entrega

O escopo inclui PostgreSQL opcional via `DATABASE_URL`, migrações versionadas, cadastro e login de professor, isolamento de projetos, ficha com dez critérios, modo banca e rascunho automático. A área de revisão aceita PDF de até 25 MB, extrai texto localmente e salva relatórios e perfis de norma no banco (ou JSON em desenvolvimento). O perfil inicial é o manual institucional informado para 2026: ABNT NBR 14724:2011. Novas versões podem ser cadastradas por ano de vigência; confirme a edição e a vigência com a instituição. O arquivo PDF enviado não é retido após a extração; apenas nome, versão do perfil e relatório com trechos de evidência ficam salvos. Sem `DATABASE_URL`, o JSON local serve somente para desenvolvimento.

A recuperação de senha usa token aleatório de uso único com validade de 15 minutos; o banco guarda somente o hash do token, e a troca invalida sessões existentes. Em produção configure `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` no ambiente do serviço. Sem SMTP, o link não é enviado em produção. No desenvolvimento local com armazenamento JSON, o link de recuperação só é devolvido para pedidos feitos a partir do próprio computador.

A revisão atual é uma checagem heurística local: procura títulos de seção, trechos candidatos a problema/objetivos/conclusão e correspondência autor/ano entre citações e referências. A similaridade com trabalhos/fontes externas e a autoria por IA ficam explicitamente como “não verificado”; não há provedor de IA ou detector validado configurado. Indicadores textuais são apenas pistas para revisão humana, nunca prova ou percentual de autoria. A análise orientativa entre problema e conclusão não decide se a pesquisa foi respondida. PDFs digitalizados sem camada de texto precisam de OCR, ainda não configurado.

## Executar

Requer Node.js 22.13 ou superior. Instale as dependências com `pnpm install`.

### PostgreSQL local com Docker

1. Instale Docker Desktop.
2. Rode `docker compose up --build` nesta pasta.
3. Abra http://localhost:3188 e crie a conta do professor.

O Compose inicia PostgreSQL, aguarda o banco ficar pronto, aplica `npm run db:migrate` e inicia o app. Os dados do banco ficam no volume `pi_avalia_db`. Para reiniciar o banco local desde zero, rode `docker compose down -v`; isso remove o volume e os dados.

### Banco hospedado

Crie um banco PostgreSQL gerenciado no provedor desejado, defina `DATABASE_URL` e mantenha `DATABASE_SSL=true` para conexões hospedadas. Copie `.env.example` para `.env`, preencha a URL sem salvar credenciais no código e execute:

```sh
npm run db:migrate
npm start
```

No Azure Database for PostgreSQL Flexible Server, use o host e as credenciais fornecidos pelo servidor, habilite acesso de rede da aplicação e mantenha TLS. O driver `pg` aceita uma URL de conexão e configura SSL no pool; o servidor Azure exige conexões TLS. [Documentação do driver pg](https://node-postgres.com/features/connecting) · [TLS no Azure PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls).

Configure `NODE_ENV=production` no serviço de hospedagem somente quando o site estiver servido por HTTPS; isso habilita o atributo `Secure` no cookie de sessão. Não coloque senhas reais no repositório.

#### Piloto no Render

O arquivo `render.yaml` descreve um serviço Docker e um PostgreSQL privado no plano gratuito para um piloto temporário. Coloque esta pasta em um repositório GitHub, conecte-o ao Render como Blueprint e confirme os dois recursos propostos. O Dockerfile aplica as migrações durante a inicialização.

O Blueprint usa a conexão interna do Render (`DATABASE_SSL=false`) e restringe o banco à rede privada do Render. O serviço recebe o endereço público gerado pelo Render para montar links de recuperação de senha. Para envio desses e-mails, configure SMTP; no plano gratuito do Render, use uma porta permitida pelo provedor de e-mail, como 2525, pois as portas 465 e 587 são bloqueadas.

Este perfil gratuito serve para uma demonstração descartável: o serviço pode dormir quando ocioso e o banco gratuito expira após 30 dias, sem backups. Não use dados reais de alunos nem dependa dos dados de teste para uso institucional. Veja as [limitações atuais do Render Free](https://render.com/docs/free).

As migrações ficam em `migrations/` e são rastreadas na tabela `schema_migrations`. Migrações existentes não são reaplicadas. O script é seguro para nova execução.

Para levar cadastros e projetos existentes do modo JSON local, aplique as migrações e rode `npm run db:import-json` com `DATABASE_URL` configurada. O importador não remove nem sobrescreve registros existentes; as sessões de login não são copiadas, então os usuários entram novamente após a migração.

`npm run test` executa os testes automatizados locais de cálculo, autenticação, isolamento entre contas e rascunhos. Para validar conexão e migrações em nuvem, configure um banco de teste e execute `npm run db:migrate` contra ele.

## Modelo de avaliação

Ficha inicial congelada na versão 1, com os dez critérios do Modelo de Critério de Avaliação — Projeto Integrador 2026. Os critérios 1–7 compõem a nota do documento (máximo 70); 8–10 compõem a apresentação oral (máximo 30). Os pesos iniciais são 1,0. A nota total é arredondada a duas casas sem usar os valores de apresentação já arredondados.

## Pendências antes de uso institucional

- Convites, participação de avaliadores e autorização por relacionamento entre professor, projeto e banca.
- Ambiente PostgreSQL hospedado e credenciais de implantação.
- Migração dos dados antigos de `data/store.json` para PostgreSQL, se houver dados que precisem ser preservados.
- Upload/armazenamento privado com validação de PDF e gestão de versões.
- Reforçar salvamento automático para uso em rede com autenticação, sincronização concorrente e controle de conflito.
- Geração de fichas, termos e relatórios PDF.
- Exclusão coordenada de projeto, dados e arquivos.
- Provedor de IA revisável, comparação com corpus autorizado, OCR e verificação formal de layout ABNT; não estão configurados e não são simulados.
- Perfis ABNT atualmente podem ser acrescentados, mas não editados/excluídos; registros de vigência precisam ser confirmados pela instituição.
- Testes de permissões e fluxos ponta a ponta.
- Revisão institucional das normas, faixas de conceitos e política de privacidade.
