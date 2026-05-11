# Slice 17 - Checklist de seguranca dos cursos

Base: todos os endpoints de gestao ficam sob `/me/courses` e exigem `Authorization: Bearer <token>`.

## Gestao do dono

- `GET /me/courses/:id` com token de outro usuario deve retornar `403`.
- `PUT /me/courses/:id` com token de outro usuario deve retornar `403`.
- `DELETE /me/courses/:id` com token de outro usuario deve retornar `403`.
- `GET/POST/PUT/DELETE /me/courses/:courseId/modules...` com token de outro usuario deve retornar `403`.
- Endpoints de aula, video, material, questionario e comentarios do criador validam a cadeia:
  - curso pertence ao dono
  - modulo pertence ao curso
  - aula pertence ao modulo
  - material/pergunta/comentario pertence a aula

## Conteudo pago do aluno

- Sem token: endpoints `/me/courses/purchased...` devem retornar `401`.
- Token sem matricula `active`: player, progresso e comentarios de aluno devem retornar `404` para matricula ativa inexistente.
- Matricula `refunded` ou `canceled`: mesmos endpoints devem retornar `404`.
- Matricula `active` em curso publicado, modulo publicado e aula publicada: player/progresso/comentarios devem retornar `200`.
- Aula publicada em modulo `draft` ou `hidden`: nao deve aparecer no player, progresso, nem comentarios de aluno.
- Curso `draft` ou `paused`: nao deve abrir player/progresso/comentarios de aluno, mesmo que exista matricula antiga.

## Validacoes

- Curso publicado exige titulo e `price_cents >= 500`.
- Curso `draft` pode ser editado com preco vazio ou abaixo de R$ 5,00.
- Slug de curso e unico pelo indice `ux_courses_slug`; em draft, mudanca de titulo recalcula slug unico.
- Status aceitos:
  - curso: `draft`, `published`, `paused`
  - modulo/aula: `draft`, `published`, `hidden`
  - matricula: `active`, `refunded`, `canceled`
- Questionario exige 2 a 8 opcoes e exatamente 1 correta; o player do aluno nunca retorna `is_correct`.
- Upload de video aceita apenas MP4, MOV ou WebM e limita em 100MB.
- Upload de material aceita apenas PDF, JPG, PNG, WebP ou GIF e limita em 25MB.
- Links de material aceitam apenas URLs `http://` ou `https://`.

## Comandos manuais sugeridos

Substitua os ids/tokens por valores reais:

```bash
curl -i "$API/me/courses/$COURSE_ID" -H "Authorization: Bearer $OTHER_USER_TOKEN"
curl -i "$API/me/courses/purchased/$COURSE_ID/player" -H "Authorization: Bearer $NO_ENROLLMENT_TOKEN"
curl -i "$API/me/courses/purchased/$COURSE_ID/lessons/$LESSON_ID/progress" \
  -X PUT -H "Authorization: Bearer $NO_ENROLLMENT_TOKEN" \
  -H "Content-Type: application/json" -d '{"completed":true}'
curl -i "$API/me/courses/purchased/$COURSE_ID/lessons/$LESSON_ID/comments" \
  -X POST -H "Authorization: Bearer $NO_ENROLLMENT_TOKEN" \
  -H "Content-Type: application/json" -d '{"body":"teste"}'
```
