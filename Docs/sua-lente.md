# Sua lente

**O que é, o que faz, o que nunca vai fazer.**

*Última atualização: 2026-11-06 — a lente passou a valer no feed. Até
então esta página descrevia um desenho (PageRank, "drifts mútuos",
"entorno", "limpar da minha lente") que o app nunca aplicou. A versão
antiga segue no histórico do repositório.*

---

## Em 30 segundos

A lente põe posts de **quem você segue** entre os primeiros das abas
**global** e **em alta**. Você escolhe a força, de 0 a 100:

- **0** (padrão): a ordem de sempre, a mesma de todo mundo.
- **50**: um card sim, um não é de quem você segue.
- **100**: primeiro os posts de quem você segue, depois o resto.

De cada pessoa, no máximo 2 posts sobem (os de mais pontos, de até 7 dias).

Ela roda no seu aparelho, a cada leitura do feed. Não muda o que os outros
veem, não é publicada e não mexe nos pontos de post nenhum. As abas
seguindo e contágio não mudam.

---

## Palavras desta página

- **Pontos (score):** o número que ordena o feed — o peso de quem impulsionou
  (DRIFT), menos um pouco o de quem afundou (SINK), mais os comentários,
  dividido pela idade do post. É igual para todo mundo.
- **Aba:** a fila de posts de cada uma das 4 abas. Global e em alta mostram
  os 50 posts de mais pontos.
- **Sua rede:** quem você segue, menos quem você bloqueou, silenciou ou
  denunciou (uma denúncia basta).
- **Afundado:** post com pontos negativos (pesou mais quem afundou).

---

## Como ela decide a ordem

A aba é refeita lugar a lugar. Com força k, entre os primeiros N cards, pelo
menos N × k ÷ 100 (arredondado para baixo) são de quem você segue —
enquanto houver posts deles. Entram só os posts de até 7 dias e, de cada
pessoa, os 2 de mais pontos: assim quem posta sem parar não ocupa a sua
lente inteira. Dentro de cada grupo, a ordem é a de sempre:
os posts da sua rede entre si pelos pontos; os outros entre si, também.

Três travas:

1. **Nunca rebaixa.** Um post que a lente escolheu e que já estava em 3º
   continua em 3º ou sobe. Mais força nunca o põe mais abaixo.
2. **Não sobe post afundado.** Se a comunidade afundou um post de quem você
   segue (pontos negativos), a lente não o adianta: ele fica onde estava.
3. **Não traz post de fora da sua rede.** Os posts de quem você segue que
   estavam fora dos 50 da aba podem entrar; para isso, saem os últimos da
   aba — nunca um post que a lente escolheu. A aba continua com o mesmo tamanho.

Exemplo, força 50: a aba tem m1, m2, m3, m4 (de quem você não segue) e, em
5º, s1 (de quem você segue); fora da aba há s2, também de quem você segue.
Resultado: m1, **s1**, m2, **s2**, m3. Com força 100: **s1, s2**, m1, m2,
m3.

Quando um post subiu pela lente, o card mostra o chip **lente**. Toque e veja
o motivo: quem você segue, a sua força e o lugar que o post teria sem a
lente.

---

## Quem entra na sua rede

Quem você segue (a sua lista NIP-02), com três exceções:

- **Bloqueados e silenciados:** ficam de fora (os posts deles nem aparecem).
- **Quem você denunciou:** sai da sua rede com uma denúncia só — de um
  post dela, ou de um post que chegou por ela na aba contágio. Nem ter
  impulsionado algo dela antes a mantém. (Na aba contágio a regra é mais
  branda: lá ela ainda pode trazer posts.)
- **Você mesmo:** seus próprios posts nunca sobem pela lente.

**Amigos de amigos não contam.** O app guarda só a sua lista de quem você
segue, não a dos seus contatos. Quando ele passar a ter essas listas, dá
para estender a lente — mas só com defesa contra contas falsas seguidas
por um contato seu (`Docs/known-limitations.md` §4c).

---

## O que a simulação mostrou

Antes de ligar, simulamos 2.250 pessoas em 6 cidades por 24 semanas (o
mundo da simulação do contágio, com o motor real de pontuação do app) e uma
rede pequena de 225 pessoas. Página animada: "Drift: lente no feed";
código: `Docs/simulacao-lente/`.

- **Funciona:** com força 50, {{sem.M50.fromF}}% dos 8 primeiros cards
  passam a ser de quem a pessoa segue (sem lente: {{sem.comum.fromF}}%);
  com 100, {{sem.M100.fromF}}%. Não chega a 100% porque cada pessoa segue
  uns 12 perfis e nem todos postam toda semana.
- **Custo:** o feed fica mais da sua cidade — dos 8 primeiros, os de outra
  cidade vão de {{sem.comum.poro}}% para {{sem.M100.poro}}% com força 100 —
  e o post mais pontuado chega a menos gente ({{sem.M100.reach}}%; sem
  lente, {{sem.comum.reach}}%). Com força 50, o alcance não muda.
- **Conta falsa que você seguiu de volta:** o spam dela sobe junto
  ({{syb.M100.sybF}}% das pessoas o veem com força 100, contra
  {{syb.comum.sybF}}% sem lente; na aba seguindo, {{syb.SEG.sybF}}%). Quem
  denuncia tira a conta da própria rede.
- **Quem posta sem parar:** uma conta seguida que inunda a rede aparece nos
  8 primeiros de {{inu.M100.sybF}}% das pessoas com força 100 — perto dos
  {{inu.SEG.sybF}}% da aba seguindo. Sem o teto de 2 por pessoa, ela tomaria
  a lente inteira.
- **Mundo frio** (quase ninguém impulsiona, como o Drift de hoje): com 100,
  {{frio.M100.fromF}}% dos 8 primeiros são de quem a pessoa segue (sem
  lente: {{frio.comum.fromF}}%). A lente não depende de voto.
- **O que a simulação não cobre:** todo mundo posta no mesmo ritmo, não há
  contas seguidas por milhares, e "reagindo ao próprio feed" supõe que
  todos usam a lente. Os números são ordem de grandeza.
- **Fazenda de contas:** a lente não é defesa. A defesa é a aba contágio.
- **A fórmula de antes não fazia nada:** multiplicar os pontos de quem você
  segue por até 2,5 deixava os 8 primeiros praticamente iguais
  ({{sem.A100.fromF}}% de quem a pessoa segue) — post sem voto tem zero
  pontos, e zero vezes 2,5 é zero.

---

## O que sua lente NÃO faz

- **Não vai para a rede.** Nada dela é publicado em evento Nostr nem
  enviado a relay.
- **Não muda pontos.** O score de cada post é o mesmo em todo cliente
  Drift. A lente só decide a ordem que a sua tela mostra.
- **Não esconde posts.** Ela só reordena; os que saem do fim da aba
  continuam no app (e na aba seguindo, se forem de quem você segue).
- **Não é juízo sobre ninguém.** Quem não está na sua rede não é "pior":
  só não é alguém que você segue.
- **Não mexe nas abas seguindo e contágio.** As duas já são feitas da sua
  rede e continuam na ordem de sempre.
- **Não lê o conteúdo dos posts.** Só quem escreveu, os pontos e a sua
  lista.

---

## Outras peças da tela "sua lente"

- **Outra lente — cronológica:** os mesmos posts das abas global e em alta,
  do mais novo para o mais velho. Sem prioridade para ninguém.
- **Destacar o que a lente adiantou:** o chip "lente" fica preenchido e
  ganha ↑.
- **Mostrar quem você segue no mapa:** no mapa da sua rede, os pontos de
  quem você segue ganham cor (só você vê). A cor vem da proximidade
  calculada no aparelho (PageRank personalizado, exato); com a lista só de
  quem você segue, quase todos ficam azuis (`Docs/known-limitations.md`
  §4g).

A força e a lente escolhida ficam guardadas só neste aparelho.

---

## Manifesto — onde a lente se encaixa

- **§24 — Algoritmo público, entradas suas.** A regra está escrita
  (`Docs/algoritmos.md` §6) e as entradas são suas: a força, quem você
  segue, quem você denunciou. A lente é a única exceção à ordem igual nas
  abas global e em alta, e só para quem a liga.
- **§7 — Determinismo.** Mesmas entradas, mesma ordem, em qualquer aparelho:
  a regra usa só inteiros e comparações, e a ordem de chegada dos eventos
  não muda nada (testado).
- **§28 — Privacidade pelo mínimo.** Tudo no aparelho; nada publicado.
- **§17 — Sem chave mestra.** Você liga, desliga e troca de lente quando
  quiser; o app não impõe nenhuma.

---

## Para quem desenvolve

- Regra: `src/lib/lens/order.ts` (`mixNetwork`, `networkQuota`,
  `canonicalCompare`). Lente: `src/lib/lens/strategies/ppr-trust.ts` (id
  histórico). Aplicação: `src/lib/feed.ts` (`withLens`,
  `getNetworkCandidates`, `startFeedLensSync`). Sua rede:
  `src/lib/contagion-data.ts` (`lensNetworkAuthors`, `loadTies`).
- Testes: `tests/lens-order.test.ts` (propriedades), 
  `tests/lens-feed-pipeline.test.ts` (evento → SQLite → feed),
  `tests/trust-lens-ppr-exact.test.ts`, `e2e/lens-feed.spec.ts`.
- Preferências: `user_prefs.lens_strength` (REAL 0..1),
  `user_prefs.active_lens`.
