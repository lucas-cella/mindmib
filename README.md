# MINDMIB
Um mapa mental para detalhar visualmente uma árvore MIB

<img width="1346" height="613" alt="image" src="https://github.com/user-attachments/assets/dd0cf253-3027-4bab-90a6-97f559cc0713" />

Visualizador de arquivos MIB (SNMP) em forma de mindmap interativo. Roda 100% no navegador: não há backend e todo o parsing acontece localmente.

- Carregue um ou mais arquivos `.mib`, `.txt` ou `.my` pelo botão **Carregar MIB** ou arrastando-os para a janela.
- Navegue pela árvore de OIDs: o **+/−** expande ou recolhe um ramo e o **nome** abre os detalhes na sidebar.
- Use a roda do mouse para dar zoom e arraste o fundo para mover a visão.
- Busque por nome ou por OID numérico com `/` ou `Ctrl+K`. Um OID de instância como `1.3.6.1.2.1.1.5.0` leva ao objeto mais próximo (`sysName`).
- As MIBs carregadas ficam salvas no `localStorage` e voltam na próxima sessão.

## Como rodar

Requer Node.js 20 ou mais recente.

```bash
npm install
npm run dev        # servidor de desenvolvimento em http://localhost:5173
npm test           # testes unitários do parser (Vitest)
npm run build      # checagem de tipos + build estático em dist/
npm run preview    # serve o build
```

O build em `dist/` é estático e usa caminhos relativos, então pode ser publicado em qualquer servidor de arquivos.

## MIBs embutidas

Estas MIBs estão sempre carregadas, para que a raiz `iso.org.dod.internet` exista e os IMPORTS mais comuns funcionem:

| Módulo | Observação |
|---|---|
| SNMPv2-SMI, SNMPv2-TC, SNMPv2-CONF | Base do SMIv2 |
| SNMPv2-MIB, IF-MIB | MIBs de sistema e interfaces |
| IANAifType-MIB | Importada pela IF-MIB (tipo `IANAifType`) |
| RFC1155-SMI, RFC1213-MIB, RFC-1215 | Base do SMIv1 e MIB-II |
| RFC-1212 | Stub mínimo: a RFC só define a macro OBJECT-TYPE v1 |

O texto dos módulos vem do repositório do [net-snmp](https://github.com/net-snmp/net-snmp/tree/master/mibs), exceto o stub da RFC-1212. Se você carregar um arquivo com um módulo de mesmo nome que um embutido (por exemplo, uma IF-MIB mais nova), a sua versão substitui a embutida.

Quando duas MIBs definem o mesmo OID (por exemplo, `sysDescr` na SNMPv2-MIB e na RFC1213-MIB), a primeira definição é a principal. As outras aparecem em "Também definido em".

## Estrutura

```
src/
  mib/            núcleo, sem DOM e testável
    lexer.ts      tokenizador (comentários, strings, hex/bin)
    parser.ts     parser tolerante de SMIv1/SMIv2
    tree.ts       resolve IMPORTS e OIDs e monta a árvore única
    syntax.ts     resolve SYNTAX via TEXTUAL-CONVENTIONs
    builtin/      MIBs embutidas
  state/store.ts  arquivos do usuário + persistência
  ui/             mindmap (d3), sidebar, busca, carregamento
tests/            testes do lexer, do parser e da árvore
```

Decisões principais:

- **TypeScript puro, sem framework.** O mindmap é SVG controlado pelo d3 (`d3-hierarchy` para o layout, `d3-zoom` para zoom e pan). O resto da interface é pequeno o bastante para alguns helpers de DOM.
- **Renderização sob demanda.** Só os ramos expandidos entram no layout e no DOM, então o custo depende do que está visível, não do tamanho das MIBs. Acima de 1.500 nós visíveis, as animações são desligadas.
- **O parser nunca aborta.** Uma definição inválida gera um diagnóstico, e o parser continua na próxima definição. Erros, imports faltando e objetos sem OID resolvido aparecem no painel **Módulos**.

## Macros suportadas

`OBJECT IDENTIFIER`, `OBJECT-TYPE` (v1 e v2), `MODULE-IDENTITY`, `OBJECT-IDENTITY`, `NOTIFICATION-TYPE`, `TRAP-TYPE`, `TEXTUAL-CONVENTION`, `OBJECT-GROUP`, `NOTIFICATION-GROUP`, `MODULE-COMPLIANCE` e `AGENT-CAPABILITIES` (parcial). Também são entendidas as atribuições de tipo (`Foo ::= OCTET STRING (SIZE (0..255))`, `SEQUENCE { ... }`, `CHOICE`, tags `[APPLICATION n] IMPLICIT`).

Para validar, o parser foi rodado sobre os 78 módulos do net-snmp sem nenhum erro e sem nenhum OID não resolvido.

## Limitações conhecidas do parser

- **Comentários seguem a regra do ASN.1.** `--` abre um comentário que termina no próximo `--` ou no fim da linha. Em MIBs de fabricante que escrevem `-- texto -- mais texto` esperando que a linha toda seja comentário, `mais texto` é lido como código. Isso pode gerar um erro naquela definição; as outras continuam sendo lidas.
- **Corpos de `MACRO` são ignorados.** Só as macros padrão listadas acima são interpretadas. Uma macro própria de fabricante é pulada, e seus valores aparecem como "definição ignorada".
- **AGENT-CAPABILITIES é parcial.** Só os campos de topo (STATUS, DESCRIPTION, PRODUCT-RELEASE, REFERENCE) são lidos. `SUPPORTS`, `INCLUDES` e `VARIATION` são ignorados.
- **Constraints incomuns ficam só como texto.** `SIZE` e faixas de valores com `|` são estruturadas. Construções mais exóticas (constraints aninhadas, `CONTAINING` etc.) aparecem apenas no texto da SYNTAX.
- **Outras atribuições de valor são ignoradas.** Só `OBJECT IDENTIFIER` é modelado; algo como `x INTEGER ::= 5` gera um aviso.
- **A resolução de nomes é tolerante.** Um símbolo que não foi importado corretamente é procurado em qualquer módulo carregado, como fazem as ferramentas SNMP comuns. Se houver homônimos, vence o primeiro módulo carregado.
- **Traps SMIv1** (`TRAP-TYPE`) são posicionadas em `enterprise.0.N`, conforme a RFC 3584.
- **Objetos cujo pai não pode ser resolvido ficam fora do mapa**, por exemplo quando o módulo importado está faltando. Eles são listados no painel **Módulos**.
- **Não há validação semântica.** Coerência de tipos, de acesso ou de INDEX não é verificada.
- **Strings:** aspas duplicadas (`""`) dentro de uma string são lidas como uma aspa escapada, conforme o ASN.1.
- **Persistência:** o `localStorage` costuma ter cerca de 5 MB. Se as MIBs não couberem, o app avisa e continua funcionando, mas elas não serão lembradas na próxima sessão.
