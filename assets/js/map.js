/* ==========================================================================
   Mapa interativo das estacoes meteorologicas
   --------------------------------------------------------------------------
   Nao ha camada de ladrilhos: a base e a malha do Estado desenhada a partir
   de sp-geo.js, e todas as sobreposicoes sao vetoriais. Assim a pagina abre
   por file:// sem depender de nenhum servico externo (a OSM exige cabecalho
   Referer e a CARTO passou a exigir chave de API; nenhum dos dois funciona
   em arquivo local).

   Camadas, de baixo para cima:
       malha do Estado        painel "base"    z 300
       relevo vetorial        painel "relevo"  z 320
       campo interpolado      painel "campo"   z 450
       divisas municipais     painel "limites" z 460
       marcadores                              z 600

   Sao dois campos interpolados, mutuamente exclusivos: temperatura (o dado)
   e confianca (o quanto o dado vale). Ambos saem da mesma grade e do mesmo
   nucleo gaussiano, definidos mais abaixo.

   Trabalho I: ESTACOES simula a resposta do backend. No Trabalho II ela sera
   substituida por um fetch em GET /api/estacoes mantendo o mesmo formato de
   objeto, de modo que o restante deste arquivo nao precise mudar.
   ========================================================================== */

(function () {
  "use strict";

  const el = document.getElementById("map");
  if (!el || typeof L === "undefined") return;

  /* Cores lidas das variaveis de themes.css para que o mapa acompanhe os
     temas Wave e Lotus sem duplicar valores. */
  const raiz = getComputedStyle(document.documentElement);
  function token(nome, reserva) {
    return raiz.getPropertyValue(nome).trim() || reserva;
  }

  const CORES = {
    alta: token("--c-accent", "#7E9CD8"),
    media: token("--c-warn", "#E6C384"),
    baixa: token("--c-alert", "#EB7986"),
  };
  const C_LINHA = token("--c-line", "#54546D");
  const C_SUPERFICIE = token("--c-surface", "#2A2A37");
  const C_TEXTO = token("--c-fg", "#DCD7BA");

  /* TODO(Trabalho II): substituir por fetch("/api/estacoes").

     Conjunto simulado com um quadro sinotico coerente, e nao numeros ao
     acaso: uma frente vinda do sul, com chuva no litoral e na Mantiqueira, e
     ar quente e seco represado no interior noroeste. E o que faz o campo
     interpolado ter gradiente para mostrar -- um sorteio uniforme produziria
     manchas sem significado e uma escala termica inutil.

     As fontes se distribuem de proposito pelos tres niveis de confianca, e
     nem toda leitura e da mesma hora: e o que exercita o decaimento por idade
     e deixa buracos de cobertura no Pontal do Paranapanema e na divisa sul,
     onde o veu da camada de temperatura precisa aparecer.

     Coordenadas reais das sedes municipais; os valores sao ficticios.
     --------------------------------------------------------------------- */
  const ESTACOES = [
    /* --- Noroeste: interior baixo, quente e seco --- */
    {
      id: "jal-01",
      nome: "Jales - Centro",
      cidade: "Jales",
      fonte: "Colaborativa",
      lat: -20.2687,
      lon: -50.5456,
      temperatura: 33.1,
      vento: 6,
      direcao: 80,
      chuva: 0.0,
      confianca: "baixa",
      atualizadoEm: "2026-09-18T07:00:00-03:00",
    },
    {
      id: "srp-01",
      nome: "São José do Rio Preto",
      cidade: "São José do Rio Preto",
      fonte: "INMET",
      lat: -20.8113,
      lon: -49.3758,
      temperatura: 32.8,
      vento: 8,
      direcao: 85,
      chuva: 0.0,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "ara-01",
      nome: "Araçatuba - IAC",
      cidade: "Araçatuba",
      fonte: "IAC/CIIAGRO",
      lat: -21.2079,
      lon: -50.4325,
      temperatura: 32.4,
      vento: 5,
      direcao: 95,
      chuva: 0.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "pep-01",
      nome: "Presidente Epitácio",
      cidade: "Presidente Epitácio",
      fonte: "Colaborativa",
      lat: -21.7633,
      lon: -52.1097,
      temperatura: 32.1,
      vento: 11,
      direcao: 105,
      chuva: 0.0,
      confianca: "baixa",
      atualizadoEm: "2026-09-18T06:00:00-03:00",
    },
    {
      id: "ppr-01",
      nome: "Presidente Prudente",
      cidade: "Presidente Prudente",
      fonte: "INMET",
      lat: -22.1207,
      lon: -51.3889,
      temperatura: 31.2,
      vento: 9,
      direcao: 115,
      chuva: 0.0,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "mar-01",
      nome: "Marília - Zona Norte",
      cidade: "Marília",
      fonte: "Estação privada",
      lat: -22.2171,
      lon: -49.9501,
      temperatura: 29.6,
      vento: 7,
      direcao: 130,
      chuva: 0.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T08:00:00-03:00",
    },

    /* --- Norte e Mogiana --- */
    {
      id: "bar-01",
      nome: "Barretos - IAC",
      cidade: "Barretos",
      fonte: "IAC/CIIAGRO",
      lat: -20.5570,
      lon: -48.5695,
      temperatura: 31.9,
      vento: 6,
      direcao: 100,
      chuva: 0.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "rpt-01",
      nome: "Ribeirão Preto - Centro",
      cidade: "Ribeirão Preto",
      fonte: "Colaborativa",
      lat: -21.1775,
      lon: -47.8103,
      temperatura: 29.8,
      vento: 4,
      direcao: 110,
      chuva: 0.0,
      confianca: "baixa",
      atualizadoEm: "2026-09-18T05:00:00-03:00",
    },
    {
      id: "fra-01",
      nome: "Franca - Aeroporto",
      cidade: "Franca",
      fonte: "INMET",
      lat: -20.5390,
      lon: -47.4010,
      temperatura: 27.4,
      vento: 12,
      direcao: 105,
      chuva: 0.0,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },

    /* --- Centro do Estado --- */
    {
      id: "bau-01",
      nome: "Bauru - Aeroporto",
      cidade: "Bauru",
      fonte: "INMET",
      lat: -22.3145,
      lon: -49.0606,
      temperatura: 30.1,
      vento: 8,
      direcao: 125,
      chuva: 0.0,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "arq-01",
      nome: "Araraquara - IAC",
      cidade: "Araraquara",
      fonte: "IAC/CIIAGRO",
      lat: -21.7845,
      lon: -48.1780,
      temperatura: 30.5,
      vento: 6,
      direcao: 120,
      chuva: 0.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "scr-01",
      nome: "São Carlos - Campus",
      cidade: "São Carlos",
      fonte: "Estação privada",
      lat: -22.0087,
      lon: -47.8909,
      temperatura: 27.8,
      vento: 10,
      direcao: 130,
      chuva: 0.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "pir-01",
      nome: "Piracicaba - ESALQ",
      cidade: "Piracicaba",
      fonte: "IAC/CIIAGRO",
      lat: -22.7253,
      lon: -47.6492,
      temperatura: 28.6,
      vento: 7,
      direcao: 135,
      chuva: 0.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T08:00:00-03:00",
    },
    {
      id: "cps-01",
      nome: "Campinas - Barão Geraldo",
      cidade: "Campinas",
      fonte: "Estação privada",
      lat: -22.8184,
      lon: -47.0647,
      temperatura: 26.3,
      vento: 7,
      direcao: 140,
      chuva: 0.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T08:00:00-03:00",
    },
    {
      id: "our-01",
      nome: "Ourinhos - Aeroporto",
      cidade: "Ourinhos",
      fonte: "INMET",
      lat: -22.9795,
      lon: -49.8695,
      temperatura: 29.0,
      vento: 9,
      direcao: 165,
      chuva: 0.0,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "ava-01",
      nome: "Avaré - Represa",
      cidade: "Avaré",
      fonte: "Estação privada",
      lat: -23.0986,
      lon: -48.9263,
      temperatura: 27.6,
      vento: 8,
      direcao: 170,
      chuva: 0.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },

    /* --- Metropolitana e Sorocaba --- */
    {
      id: "sor-01",
      nome: "Sorocaba - ICTS",
      cidade: "Sorocaba",
      fonte: "Estação privada",
      lat: -23.5015,
      lon: -47.4526,
      temperatura: 24.1,
      vento: 12,
      direcao: 160,
      chuva: 0.0,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "spo-01",
      nome: "São Paulo - Mirante de Santana",
      cidade: "São Paulo",
      fonte: "INMET",
      lat: -23.4961,
      lon: -46.6199,
      temperatura: 22.7,
      vento: 9,
      direcao: 150,
      chuva: 1.2,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "itp-01",
      nome: "Itapetininga - Centro",
      cidade: "Itapetininga",
      fonte: "Colaborativa",
      lat: -23.5917,
      lon: -48.0533,
      temperatura: 25.4,
      vento: 17,
      direcao: 200,
      chuva: 0.4,
      confianca: "baixa",
      atualizadoEm: "2026-09-18T06:00:00-03:00",
    },
    {
      id: "bgp-01",
      nome: "Bragança Paulista",
      cidade: "Bragança Paulista",
      fonte: "Estação privada",
      lat: -22.9526,
      lon: -46.5417,
      temperatura: 24.8,
      vento: 5,
      direcao: 145,
      chuva: 0.2,
      confianca: "media",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },

    /* --- Vale do Paraiba e Mantiqueira --- */
    {
      id: "sjc-01",
      nome: "São José dos Campos",
      cidade: "São José dos Campos",
      fonte: "INMET",
      lat: -23.1896,
      lon: -45.8841,
      temperatura: 24.3,
      vento: 7,
      direcao: 145,
      chuva: 0.6,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "tau-01",
      nome: "Taubaté - Bairro do Barreiro",
      cidade: "Taubaté",
      fonte: "Estação privada",
      lat: -23.0264,
      lon: -45.5553,
      temperatura: 25.2,
      vento: 6,
      direcao: 150,
      chuva: 0.8,
      confianca: "media",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "cjo-01",
      nome: "Campos do Jordão",
      cidade: "Campos do Jordão",
      fonte: "INMET",
      lat: -22.7397,
      lon: -45.5914,
      temperatura: 17.9,
      vento: 34,
      direcao: 175,
      chuva: 2.4,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },

    /* --- Litoral --- */
    {
      id: "uba-01",
      nome: "Ubatuba - Itaguá",
      cidade: "Ubatuba",
      fonte: "CEMADEN",
      lat: -23.4336,
      lon: -45.0838,
      temperatura: 24.0,
      vento: 24,
      direcao: 155,
      chuva: 5.2,
      confianca: "media",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "san-01",
      nome: "Santos - Ponta da Praia",
      cidade: "Santos",
      fonte: "INMET",
      lat: -23.9608,
      lon: -46.3336,
      temperatura: 23.4,
      vento: 28,
      direcao: 170,
      chuva: 3.1,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "reg-01",
      nome: "Registro - Vale do Ribeira",
      cidade: "Registro",
      fonte: "INMET",
      lat: -24.4871,
      lon: -47.8442,
      temperatura: 22.9,
      vento: 19,
      direcao: 185,
      chuva: 4.4,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "can-01",
      nome: "Cananéia - Porto",
      cidade: "Cananéia",
      fonte: "CEMADEN",
      lat: -25.0148,
      lon: -47.9268,
      temperatura: 22.1,
      vento: 31,
      direcao: 190,
      chuva: 6.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T08:00:00-03:00",
    },

    /* --- Sul --- */
    {
      id: "ite-01",
      nome: "Itapeva - IAC",
      cidade: "Itapeva",
      fonte: "IAC/CIIAGRO",
      lat: -23.9821,
      lon: -48.8758,
      temperatura: 23.6,
      vento: 22,
      direcao: 195,
      chuva: 1.1,
      confianca: "media",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
  ];

  const lista = document.getElementById("station-grid");
  const listaStatus = document.getElementById("station-list-status");
  const status = document.getElementById("map-status");

  const marcadores = new Map();

  /* ---------------------------------------------------------------------
     Mapa e base territorial
     --------------------------------------------------------------------- */

  const mapa = L.map(el, {
    /* Passos de zoom fracionados: com poucos niveis uteis, o enquadramento
       do Estado fica mais justo. */
    zoomSnap: 0.25,
    minZoom: 5,
    maxZoom: 12,
    scrollWheelZoom: false,
    attributionControl: true,
  });

  /* Painel proprio abaixo do overlayPane (400): a malha do Estado e o fundo
     de tudo, e qualquer sobreposicao cai por cima sem depender da ordem em
     que as camadas foram adicionadas. */
  mapa.createPane("base");
  mapa.getPane("base").style.zIndex = 300;

  mapa.attributionControl.addAttribution(
    'Malha territorial: <a href="https://www.ibge.gov.br/">IBGE</a>'
  );

  if (!window.SP_GEOJSON) {
    if (status) status.textContent = "Não foi possível carregar a malha do Estado.";
    return;
  }

  const estado = L.geoJSON(window.SP_GEOJSON, {
    pane: "base",
    style: {
      color: C_LINHA,
      weight: 1.5,
      fillColor: C_SUPERFICIE,
      fillOpacity: 1,
    },
    /* A malha e decorativa: quem usa teclado ou leitor de tela navega pelos
       marcadores e pela lista textual, nao pelo contorno. */
    interactive: false,
  }).addTo(mapa);

  const LIMITES = estado.getBounds();
  mapa.fitBounds(LIMITES, { padding: [8, 8] });
  mapa.setMaxBounds(LIMITES.pad(0.25));

  /* ---------------------------------------------------------------------
     Relevo vetorial
     ---------------------------------------------------------------------
     relevo-sp.js traz os aneis das regioes {altitude >= t}, t = 200, 400,...
     As duas camadas compartilham os mesmos vetores: preenchidos viram faixas
     altimetricas, tracados viram curvas de nivel. Nenhuma geometria e
     duplicada, apenas o estilo muda.

     Renderizador em canvas, e nao SVG: sao alguns milhares de vertices por
     nivel, e como nos do DOM isso derrubaria o deslocamento do mapa. O dado
     continua vetorial, logo o traco permanece nitido em qualquer zoom.
     --------------------------------------------------------------------- */

  mapa.createPane("relevo");
  mapa.getPane("relevo").style.zIndex = 320;

  const tracadorRelevo = L.canvas({ pane: "relevo", padding: 0.3 });

  const camadaHipsometria = L.layerGroup();
  const camadaCurvas = L.layerGroup();
  const faixasRelevo = [];
  const curvasRelevo = [];

  /* Rampa altimetrica, lida do tema: uma cor por faixa de INTERVALO_RELEVO
     metros. --relevo-0 e o piso (0 a 200 m), que nao tem anel proprio -- e o
     que sobra da malha do Estado --, e --relevo-k pinta a faixa que comeca em
     k * INTERVALO_RELEVO. Mantendo as cores no CSS, Wave e Lotus ganham
     rampas diferentes sem que este arquivo saiba de nenhuma das duas. */
  const INTERVALO_RELEVO =
    (window.SP_RELEVO && window.SP_RELEVO.intervalo) || 200;

  function rampaRelevo() {
    const atual = getComputedStyle(document.documentElement);
    const cores = [];
    for (let k = 0; ; k++) {
      const c = atual.getPropertyValue("--relevo-" + k).trim();
      if (!c) break;
      cores.push(c);
    }
    return cores.length ? cores : [C_SUPERFICIE, C_LINHA];
  }

  /* Acima do ultimo tom da rampa tudo recebe o tom do topo: a escala pode ser
     mais curta que os niveis do arquivo sem quebrar nada. */
  function corDoNivel(altitude, cores) {
    const k = Math.round(altitude / INTERVALO_RELEVO);
    return cores[Math.min(Math.max(k, 0), cores.length - 1)];
  }

  /* Curva mestra a cada 1000 m, como nas cartas topograficas do IBGE. */
  function ehMestra(altitude) {
    return altitude % 1000 === 0;
  }

  if (window.SP_RELEVO) {
    const cores = rampaRelevo();

    window.SP_RELEVO.niveis.forEach(function (nivel) {
      /* As regioes sao acumuladas e portanto encaixadas umas nas outras:
         {alt >= 400} esta inteira dentro de {alt >= 200}. Pintadas da mais
         baixa para a mais alta, cada uma cobre a anterior e o que sobra a
         vista e exatamente a faixa daquele nivel. A ordem de insercao e a
         ordem de desenho no renderizador em canvas, entao os niveis precisam
         continuar em ordem crescente no arquivo.

         fillRule evenodd resolve de brinde o caso raro de uma depressao
         fechada acima do limiar: o anel interno vira furo. */
      const faixa = L.polygon(nivel.aneis, {
        renderer: tracadorRelevo,
        pane: "relevo",
        stroke: false,
        fillRule: "evenodd",
        fillColor: corDoNivel(nivel.altitude, cores),
        /* Nao opaco de proposito: o contorno da malha, que fica no painel de
           baixo, continua visivel por tras da faixa mais baixa. */
        fillOpacity: 0.85,
        interactive: false,
      });

      /* Mesmo array de aneis, outro estilo: as curvas de nivel sao o contorno
         das faixas, e recebem a cor da sua propria altitude para que as duas
         camadas digam a mesma coisa quando ligadas juntas. */
      const curva = L.polygon(nivel.aneis, {
        renderer: tracadorRelevo,
        pane: "relevo",
        color: corDoNivel(nivel.altitude, cores),
        weight: ehMestra(nivel.altitude) ? 1.3 : 0.6,
        opacity: ehMestra(nivel.altitude) ? 0.95 : 0.8,
        fill: false,
        interactive: false,
      });

      /* A altitude fica guardada na camada: e ela que permite repintar a
         rampa inteira na troca de tema sem reconstruir geometria. */
      faixa.altitude = nivel.altitude;
      curva.altitude = nivel.altitude;

      faixasRelevo.push(faixa);
      curvasRelevo.push(curva);
      camadaHipsometria.addLayer(faixa);
      camadaCurvas.addLayer(curva);
    });

    mapa.attributionControl.addAttribution(
      'Altimetria: <a href="http://www.dsr.inpe.br/topodata/">TOPODATA/INPE</a>'
    );
  }

  /* A escala sai dos niveis que sobraram no arquivo, e nao de uma lista fixa:
     se um nivel alto desaparecer por area minima, a legenda acompanha. Sem
     ela as cores seriam enfeite -- e e este bloco o equivalente textual da
     camada para quem nao distingue os tons. */
  function montarLegendaRelevo() {
    const alvo = document.getElementById("legenda-relevo");
    if (!alvo || !window.SP_RELEVO || !window.SP_RELEVO.niveis.length) return;

    const cores = rampaRelevo();
    const niveis = window.SP_RELEVO.niveis;
    const topo = niveis[niveis.length - 1].altitude;

    const faixas = [{ de: 0, cor: cores[0] }];
    niveis.forEach(function (nivel) {
      faixas.push({ de: nivel.altitude, cor: corDoNivel(nivel.altitude, cores) });
    });

    /* Da mais alta para a mais baixa, como nas escalas hipsometricas
       impressas. */
    alvo.innerHTML = faixas
      .slice()
      .reverse()
      .map(function (faixa) {
        const rotulo =
          faixa.de === topo
            ? "acima de " + faixa.de + " m"
            : faixa.de + " a " + (faixa.de + INTERVALO_RELEVO) + " m";
        return [
          '<div class="legend-item">',
          '  <dt><span class="legend-swatch legend-swatch-faixa" style="background-color: ',
          faixa.cor,
          '" aria-hidden="true"></span>',
          rotulo,
          "</dt>",
          "</div>",
        ].join("");
      })
      .join("");
  }

  /* ---------------------------------------------------------------------
     Divisas municipais
     ---------------------------------------------------------------------
     sp-municipios.js traz a malha municipal do IBGE simplificada, com nome,
     codigo, centro e bbox por municipio. Painel acima do campo interpolado:
     a divisa e referencia de leitura e precisa continuar visivel com as
     isotermas ligadas.

     Renderizador em canvas pelo mesmo motivo do relevo, so que mais forte:
     sao 645 poligonos, e em SVG seriam 645 nos no DOM arrastados a cada
     deslocamento do mapa.

     Acessibilidade: a camada e desenho, e desenho nao e navegavel. Marcar os
     645 poligonos como interativos criaria uma armadilha de TAB e nao daria
     nada a quem usa leitor de tela. O equivalente acessivel e o seletor da
     barra lateral: um <select> nativo -- pesquisavel pela digitacao, operavel
     so com o teclado, anunciado pelo leitor de tela sem nenhum ARIA -- que
     entrega em texto o que a divisa entrega em traco.
     --------------------------------------------------------------------- */

  mapa.createPane("limites");
  mapa.getPane("limites").style.zIndex = 460;

  const tracadorLimites = L.canvas({ pane: "limites", padding: 0.3 });

  const camadaMunicipios = L.geoJSON(window.SP_MUNICIPIOS || null, {
    renderer: tracadorLimites,
    pane: "limites",
    style: {
      color: C_LINHA,
      weight: 0.6,
      opacity: 0.9,
      fill: false,
    },
    interactive: false,
  });

  /* Camada propria, sempre no mapa: o realce responde ao seletor, e nao a
     caixa de selecao. Quem consulta um municipio com as divisas desligadas
     continua vendo qual deles foi enquadrado. */
  const realceMunicipio = L.geoJSON(null, {
    renderer: tracadorLimites,
    pane: "limites",
    style: {
      color: token("--c-accent", CORES.alta),
      weight: 2.5,
      opacity: 1,
      fill: false,
    },
    interactive: false,
  }).addTo(mapa);

  function nivelDeConfianca(valor) {
    if (valor >= LIMIARES[1]) return "alta";
    if (valor >= LIMIARES[0]) return "media";
    return "baixa";
  }

  function estacaoMaisProxima(lat, lon) {
    let melhor = null;
    let menor = Infinity;
    ESTACOES.forEach(function (e) {
      const d = ClimaCampo.distanciaKm(lat, lon, e.lat, e.lon);
      if (d < menor) { menor = d; melhor = e; }
    });
    return melhor ? { estacao: melhor, km: menor } : null;
  }

  /* O texto e o produto principal desta funcao: o enquadramento do mapa e o
     realce sao o complemento visual dele, e nao o contrario. */
  function descreverMunicipio(props, centro) {
    const partes = [props.nome + "."];

    if (typeof ClimaCampo !== "undefined") {
      const t = temperaturaEm(centro[0], centro[1]);
      const c = confiancaEm(centro[0], centro[1]);
      partes.push(
        "Temperatura interpolada de " + t.toFixed(1) +
        " graus Celsius, com confiança " + ROTULO_NIVEL[nivelDeConfianca(c)] + "."
      );
    }

    if (typeof ClimaCampo !== "undefined") {
      const w = ventoEm(centro[0], centro[1]);
      if (w) {
        partes.push(
          "Vento de " + Math.round(w.escalar) + " quilômetros por hora, " +
          "soprando para " + rosaDosVentos(Math.atan2(w.u, w.v) * 180 / Math.PI) + "."
        );
      }
    }

    const perto = estacaoMaisProxima(centro[0], centro[1]);
    if (perto) {
      partes.push(
        "Estação mais próxima: " + perto.estacao.nome + ", a " +
        Math.round(perto.km) + " quilômetros, " +
        perto.estacao.temperatura.toFixed(1) + " graus Celsius."
      );
    }

    return partes.join(" ");
  }

  function montarSeletorMunicipios() {
    const seletor = document.getElementById("municipio-seletor");
    if (!seletor) return;

    const dados = window.SP_MUNICIPIOS;
    if (!dados || !dados.features || !dados.features.length) {
      seletor.disabled = true;
      return;
    }

    /* Ordem alfabetica em pt-BR: sem localeCompare, "Aguas de Lindoia" e
       "Agudos" sairiam na ordem do codigo do IBGE, que nao ajuda ninguem. */
    const ordenados = dados.features.slice().sort(function (a, b) {
      return a.properties.nome.localeCompare(b.properties.nome, "pt-BR");
    });

    const fragmento = document.createDocumentFragment();
    ordenados.forEach(function (feicao, k) {
      const opcao = document.createElement("option");
      opcao.value = String(k);
      opcao.textContent = feicao.properties.nome;
      fragmento.appendChild(opcao);
    });
    seletor.appendChild(fragmento);

    seletor.addEventListener("change", function () {
      realceMunicipio.clearLayers();

      if (seletor.value === "") {
        if (status) status.textContent = "Nenhum município selecionado.";
        return;
      }

      const feicao = ordenados[Number(seletor.value)];
      if (!feicao) return;

      realceMunicipio.addData(feicao);

      /* bbox do arquivo em vez de getBounds() da camada: enquadra sem
         depender de a camada de divisas estar ligada. */
      const caixa = feicao.properties.bbox;
      if (caixa) {
        mapa.fitBounds(
          L.latLngBounds([caixa[1], caixa[0]], [caixa[3], caixa[2]]),
          { padding: [24, 24], maxZoom: 10 }
        );
      }

      if (status) {
        status.textContent = descreverMunicipio(
          feicao.properties,
          feicao.properties.centro
        );
      }
    });
  }

  /* ---------------------------------------------------------------------
     Campo de confianca
     ---------------------------------------------------------------------
     A confianca de um ponto nao e a media das confiancas vizinhas: isso diria
     o que as estacoes proximas afirmam, nao o quanto vale o numero mostrado
     ali. O que se mede aqui e evidencia. Cada estacao contribui com um peso
     p_i (qualidade da fonte, decaida pela idade da leitura) atenuado por um
     nucleo gaussiano de alcance ALCANCE_KM, e as contribuicoes se combinam
     como probabilidades independentes:

         C = 1 - PRODUTO(1 - p_i * exp(-(d_i / L)^2))

     Duas estacoes medianas proximas valem mais que uma sozinha, e nenhuma
     combinacao chega a 1: o campo nunca afirma certeza onde ninguem mediu.

     Tres faixas, e nao cinco: sao exatamente as tres da legenda que ja existe
     na pagina, com as mesmas tres variaveis de cor. O que este campo responde
     e "da para confiar no numero daqui?", e para essa pergunta tres degraus
     bastam -- a graduacao fina fica com o campo de temperatura, que e onde a
     precisao significa alguma coisa.
     --------------------------------------------------------------------- */

  const QUALIDADE = { alta: 0.95, media: 0.7, baixa: 0.4 };

  /* As chaves internas ficam sem acento (sao identificadores, e o backend do
     Trabalho II vai devolver essas mesmas chaves); o texto exibido e este. */
  const ROTULO_NIVEL = { alta: "alta", media: "média", baixa: "baixa" };
  const ALCANCE_KM = 60;   /* comprimento de correlacao espacial */
  const MEIA_VIDA_H = 6;   /* a cada 6 h a leitura vale metade */
  const LIMIARES = [1 / 3, 2 / 3];

  /* Referencia de tempo: a leitura mais recente do conjunto, e nao o relogio
     do navegador. O mapa fica deterministico -- as capturas do relatorio
     continuam batendo com o codigo daqui a um mes. */
  const REFERENCIA = Math.max.apply(
    null,
    ESTACOES.map(function (e) { return Date.parse(e.atualizadoEm); })
  );

  const PESOS = ESTACOES.map(function (e) {
    const idadeH = (REFERENCIA - Date.parse(e.atualizadoEm)) / 3600000;
    return {
      lat: e.lat,
      lon: e.lon,
      temp: e.temperatura,
      peso: (QUALIDADE[e.confianca] || 0.4) * Math.pow(2, -idadeH / MEIA_VIDA_H),
    };
  });

  function confiancaEm(lat, lon) {
    let restante = 1;
    for (let i = 0; i < PESOS.length; i++) {
      const d = ClimaCampo.distanciaKm(lat, lon, PESOS[i].lat, PESOS[i].lon) / ALCANCE_KM;
      restante *= 1 - PESOS[i].peso * Math.exp(-d * d);
    }
    return 1 - restante;
  }

  mapa.createPane("campo");
  mapa.getPane("campo").style.zIndex = 450;

  const tracadorCampo = L.canvas({ pane: "campo", padding: 0.3 });

  const camadaConfianca = L.layerGroup();
  const faixasCampo = [];

  function montarLegendaConfianca(fracoes) {
    const alvo = document.getElementById("legenda-confianca");
    const resumo = document.getElementById("campo-resumo");

    const rotulos = [
      ["baixa", "Confiança baixa", "Nenhuma estação próxima o bastante."],
      ["media", "Confiança média", "Uma estação próxima, ou várias distantes."],
      ["alta", "Confiança alta", "Evidência suficiente para interpolar."],
    ];

    if (alvo) {
      alvo.innerHTML = rotulos.map(function (linha, k) {
        return [
          '<div class="legend-item">',
          '  <dt><span class="legend-swatch legend-swatch-faixa" style="background-color: ',
          CORES[linha[0]], '" aria-hidden="true"></span>', linha[1], "</dt>",
          "  <dd>", linha[2], " ", Math.round(fracoes[k] * 100), "% do território.</dd>",
          "</div>",
        ].join("");
      }).join("");
    }

    /* As porcentagens sao o equivalente textual do campo: quem nao distingue
       as cores le a mesma informacao em numeros. */
    if (resumo) {
      resumo.textContent =
        "Cobertura confiável em " + Math.round(fracoes[2] * 100) +
        "% do território; em " + Math.round(fracoes[0] * 100) +
        "% não há estação próxima o bastante para sustentar a interpolação.";
    }
  }

  /* ---------------------------------------------------------------------
     Campo de temperatura
     ---------------------------------------------------------------------
     Aqui a media ponderada e exatamente o que se quer: o valor plausivel em
     um ponto onde ninguem mediu. Mesmo nucleo gaussiano e mesmos pesos do
     campo de confianca -- qualidade da fonte, decaida pela idade da leitura
     --, agora normalizados:

         T = SOMA(w_i * T_i) / SOMA(w_i),   w_i = p_i * exp(-(d_i / L)^2)

     Por construcao o resultado fica entre a menor e a maior leitura: a
     interpolacao nunca inventa um extremo que nenhuma estacao viu.

     A escala e fixa, de TEMP_BASE a TEMP_TOPO em passos de TEMP_INTERVALO, e
     nao ajustada aos dados do dia: duas capturas de dias diferentes so podem
     ser comparadas se a mesma cor significar a mesma temperatura nas duas.
     Isotermas de 2 C sao o intervalo usual das cartas sinoticas.

     A media ponderada, porem, responde em todo o Estado, inclusive a algumas
     centenas de quilometros da estacao mais proxima, onde ela e pura
     extrapolacao. Por isso a camada carrega um veu sobre a regiao de
     confianca baixa: a mesma geometria da faixa mais baixa do outro campo,
     pintada com a cor da pagina por cima das isotermas. O campo continua
     continuo -- o que some e a pretensao de que aquilo ali foi medido.
     --------------------------------------------------------------------- */

  const TEMP_BASE = 10;      /* piso da escala, em graus Celsius */
  const TEMP_TOPO = 34;      /* acima disto, um unico tom de topo */
  const TEMP_INTERVALO = 2;  /* uma faixa a cada 2 C */

  const TEMP_LIMIARES = [];
  for (let t = TEMP_BASE + TEMP_INTERVALO; t <= TEMP_TOPO; t += TEMP_INTERVALO) {
    TEMP_LIMIARES.push(t);
  }

  const TEMP_MEDIA =
    ESTACOES.reduce(function (soma, e) { return soma + e.temperatura; }, 0) /
    (ESTACOES.length || 1);

  function temperaturaEm(lat, lon) {
    let soma = 0;
    let total = 0;
    for (let i = 0; i < PESOS.length; i++) {
      const d = ClimaCampo.distanciaKm(lat, lon, PESOS[i].lat, PESOS[i].lon) / ALCANCE_KM;
      const w = PESOS[i].peso * Math.exp(-d * d);
      soma += w * PESOS[i].temp;
      total += w;
    }
    /* Longe de todas as estacoes os pesos chegam a zero por subfluxo e a
       divisao ficaria indefinida. Cair na media do conjunto mantem o campo
       finito; o veu ja avisa que ali nao ha evidencia nenhuma. */
    return total > 0 ? soma / total : TEMP_MEDIA;
  }

  const camadaTemperatura = L.layerGroup();
  const faixasTemperatura = [];
  let veuTemperatura = null;
  let fracoesTemperatura = null;

  /* Rampa termica lida do tema, na mesma convencao da altimetrica: --temp-k
     pinta a faixa de indice k, contada a partir de "abaixo de TEMP_BASE +
     TEMP_INTERVALO". Wave e Lotus definem rampas diferentes sem que este
     arquivo saiba de nenhuma das duas. */
  function rampaTemp() {
    const atual = getComputedStyle(document.documentElement);
    const cores = [];
    for (let k = 0; ; k++) {
      const c = atual.getPropertyValue("--temp-" + k).trim();
      if (!c) break;
      cores.push(c);
    }
    return cores.length ? cores : [C_SUPERFICIE, C_TEXTO];
  }

  function corDaFaixaTemp(k, cores) {
    return cores[Math.min(Math.max(k, 0), cores.length - 1)];
  }

  function rotuloFaixaTemp(k) {
    if (k === 0) return "abaixo de " + TEMP_LIMIARES[0] + " \u00B0C";
    if (k >= TEMP_LIMIARES.length) return "acima de " + TEMP_TOPO + " \u00B0C";
    return TEMP_LIMIARES[k - 1] + " a " + TEMP_LIMIARES[k] + " \u00B0C";
  }

  /* So as faixas que de fato ocorrem entram na escala: com treze linhas, das
     quais dez zeradas, as tres que importam se perdem. O criterio e o mesmo
     da legenda altimetrica -- a legenda segue os dados, nao uma lista fixa. */
  function montarLegendaTemperatura() {
    const alvo = document.getElementById("legenda-temperatura");
    if (!alvo || !fracoesTemperatura) return;

    const cores = rampaTemp();
    const itens = [];
    fracoesTemperatura.forEach(function (fracao, k) {
      if (fracao >= 0.005) itens.push({ k: k, fracao: fracao });
    });

    const escala = itens.reverse().map(function (item) {
      return [
        '<div class="legend-item">',
        '  <dt><span class="legend-swatch legend-swatch-faixa" style="background-color: ',
        corDaFaixaTemp(item.k, cores), '" aria-hidden="true"></span>',
        rotuloFaixaTemp(item.k), "</dt>",
        "  <dd>", Math.round(item.fracao * 100), "% do território.</dd>",
        "</div>",
      ].join("");
    }).join("");

    alvo.innerHTML = escala + [
      '<div class="legend-item">',
      '  <dt><span class="legend-swatch legend-swatch-veu" aria-hidden="true"></span>',
      "Área esmaecida</dt>",
      "  <dd>Valor extrapolado: nenhuma estação próxima o bastante.</dd>",
      "</div>",
    ].join("");
  }

  /* Equivalente textual do campo, para quem nao distingue os tons: a faixa de
     leituras que o sustenta e quanto do Estado esta fora de alcance. */
  function montarResumoTemperatura(fracaoBaixa) {
    const alvo = document.getElementById("temperatura-resumo");
    if (!alvo) return;

    const temps = ESTACOES.map(function (e) { return e.temperatura; });
    alvo.textContent =
      "Interpolado a partir de " + ESTACOES.length + " estações, entre " +
      Math.min.apply(null, temps).toFixed(1) + " e " +
      Math.max.apply(null, temps).toFixed(1) + " graus Celsius. Em " +
      Math.round(fracaoBaixa * 100) + "% do território não há estação próxima " +
      "o bastante, e a area aparece esmaecida.";
  }

  /* ---------------------------------------------------------------------
     Campo de vento
     ---------------------------------------------------------------------
     Vento nao e um numero, e um vetor, e por isso ele nao e mais um campo
     colorido: nenhuma escala de cor carrega direcao. Vira uma malha de setas,
     que se sobrepoe a temperatura em vez de disputar lugar com ela -- dai
     estar entre as caixas de selecao, e nao entre as opcoes de radio.

     Interpolar direcao pela media dos angulos daria errado, e errado do pior
     jeito: 350 graus com 10 graus tem media 180: exatamente o rumo oposto ao
     certo. Entao interpolam-se as componentes,

         u = -V * sen(dir)    (para leste)
         v = -V * cos(dir)    (para norte)

     e o angulo e recomposto no fim. dir e a direcao meteorologica, de onde o
     vento vem; a seta aponta para onde ele vai.

     Da media vetorial sai um segundo numero de graca. Onde as estacoes
     discordam de rumo, as componentes se cancelam e |(u,v)| fica bem abaixo
     da media das velocidades. A razao entre as duas e a constancia do vento,
     entre 0 e 1, e ela comanda a opacidade da seta: rumo mal definido, seta
     apagada. A cor continua vindo da media escalar, que e o que a pergunta
     "esta ventando muito aqui?" quer saber.

     Comprimento igual para todas as setas, de proposito: comprimento e cor
     dizendo a mesma coisa seria redundante, e setas curtas onde venta pouco
     sumiriam justamente onde a direcao ainda interessa.
     --------------------------------------------------------------------- */

  const VENTO_LIMIARES = [5, 12, 20, 30, 45]; /* km/h */

  const VENTO_ROTULOS = [
    ["Calmaria", "abaixo de 5 km/h"],
    ["Brisa leve", "5 a 12 km/h"],
    ["Vento moderado", "12 a 20 km/h"],
    ["Vento forte", "20 a 30 km/h"],
    ["Vento muito forte", "30 a 45 km/h"],
    ["Vendaval", "acima de 45 km/h"],
  ];

  /* Espacamento e comprimento em pixels, nao em graus: a malha de setas e
     remontada a cada zoom para manter a mesma densidade na tela. Em graus
     fixos, o mapa ficaria vazio de perto e ilegivel de longe. */
  const VENTO_PASSO_PX = 46;
  const VENTO_COMP_PX = 30;
  const VENTO_MAX_SETAS = 500; /* teto de seguranca por redesenho */

  const ROSA = [
    "norte", "nordeste", "leste", "sudeste",
    "sul", "sudoeste", "oeste", "noroeste",
  ];

  function rosaDosVentos(graus) {
    const k = Math.round(((graus % 360) + 360) % 360 / 45) % 8;
    return ROSA[k];
  }

  const VENTOS = ESTACOES.map(function (e, i) {
    const rad = (e.direcao || 0) * Math.PI / 180;
    return {
      lat: e.lat,
      lon: e.lon,
      peso: PESOS[i].peso,
      velocidade: e.vento,
      u: -e.vento * Math.sin(rad),
      v: -e.vento * Math.cos(rad),
    };
  });

  function ventoEm(lat, lon) {
    let u = 0, v = 0, escalar = 0, total = 0;

    for (let i = 0; i < VENTOS.length; i++) {
      const d = ClimaCampo.distanciaKm(lat, lon, VENTOS[i].lat, VENTOS[i].lon) / ALCANCE_KM;
      const w = VENTOS[i].peso * Math.exp(-d * d);
      u += w * VENTOS[i].u;
      v += w * VENTOS[i].v;
      escalar += w * VENTOS[i].velocidade;
      total += w;
    }

    if (!(total > 0)) return null;

    u /= total;
    v /= total;
    escalar /= total;

    const vetorial = Math.sqrt(u * u + v * v);
    return {
      u: u,
      v: v,
      escalar: escalar,
      constancia: escalar > 0 ? Math.min(vetorial / escalar, 1) : 0,
    };
  }

  mapa.createPane("vento");
  mapa.getPane("vento").style.zIndex = 455;

  const tracadorVento = L.canvas({ pane: "vento", padding: 0.3 });
  const camadaVento = L.layerGroup();

  function rampaVento() {
    const atual = getComputedStyle(document.documentElement);
    const cores = [];
    for (let k = 0; ; k++) {
      const c = atual.getPropertyValue("--vento-" + k).trim();
      if (!c) break;
      cores.push(c);
    }
    return cores.length ? cores : [C_LINHA, C_TEXTO];
  }

  function faixaDoVento(kmh) {
    let k = 0;
    while (k < VENTO_LIMIARES.length && kmh >= VENTO_LIMIARES[k]) k++;
    return k;
  }

  /* A seta inteira como uma unica linha quebrada: haste, ponta, asa, volta a
     ponta, outra asa. Um traco so por seta, em vez de tres camadas. */
  function pontosDaSeta(lat, lon, vento, comp) {
    const rumo = Math.atan2(vento.u, vento.v); /* para onde o vento vai */

    /* Correcao de Mercator: um grau de latitude ocupa mais pixels que um grau
       de longitude, na razao 1/cos(lat). Sem isto as setas saem tortas, e
       tanto mais quanto mais ao sul do Estado. */
    const escala = Math.cos(lat * Math.PI / 180);

    function mover(base, angulo, dist) {
      return [
        base[0] + dist * Math.cos(angulo) * escala,
        base[1] + dist * Math.sin(angulo),
      ];
    }

    const centro = [lat, lon];
    const cauda = mover(centro, rumo + Math.PI, comp / 2);
    const ponta = mover(centro, rumo, comp / 2);
    const asa = comp * 0.34;

    return [
      cauda,
      ponta,
      mover(ponta, rumo + 2.6, asa), /* 2,6 rad = 149 graus */
      ponta,
      mover(ponta, rumo - 2.6, asa),
    ];
  }

  function desenharVento() {
    camadaVento.clearLayers();

    if (!mapa.hasLayer(camadaVento)) return;
    if (typeof ClimaCampo === "undefined" || !window.SP_GEOJSON) return;

    /* Pixels por grau de longitude no zoom atual: 256 px por ladrilho, 360
       graus na volta do mundo. */
    const px = 256 * Math.pow(2, mapa.getZoom()) / 360;
    const passo = VENTO_PASSO_PX / px;
    const comp = VENTO_COMP_PX / px;

    const vista = mapa.getBounds();
    const oeste = Math.max(vista.getWest(), LIMITES.getWest());
    const leste = Math.min(vista.getEast(), LIMITES.getEast());
    const sul = Math.max(vista.getSouth(), LIMITES.getSouth());
    const norte = Math.min(vista.getNorth(), LIMITES.getNorth());
    if (oeste >= leste || sul >= norte) return;

    const cores = rampaVento();
    let desenhadas = 0;

    /* Grade ancorada em multiplos do passo, e nao no canto da vista: assim as
       setas ficam paradas quando o mapa e arrastado, em vez de escorregarem
       junto com a borda. */
    for (let lat = Math.ceil(sul / passo) * passo; lat <= norte; lat += passo) {
      for (let lon = Math.ceil(oeste / passo) * passo; lon <= leste; lon += passo) {
        if (desenhadas >= VENTO_MAX_SETAS) return;
        if (!ClimaCampo.dentroDaMalha(window.SP_GEOJSON, lat, lon)) continue;

        const vento = ventoEm(lat, lon);
        if (!vento) continue;

        const faixa = faixaDoVento(vento.escalar);

        L.polyline(pontosDaSeta(lat, lon, vento, comp), {
          renderer: tracadorVento,
          pane: "vento",
          color: cores[Math.min(faixa, cores.length - 1)],
          weight: 1.6,
          opacity: 0.35 + 0.65 * vento.constancia,
          lineCap: "round",
          lineJoin: "round",
          fill: false,
          interactive: false,
        }).addTo(camadaVento);

        desenhadas++;
      }
    }
  }

  /* A escala do vento e fixa, como a Beaufort: todas as faixas aparecem,
     ocorram ou nao hoje. Quem le a legenda uma vez a reconhece amanha. */
  function montarLegendaVento() {
    const alvo = document.getElementById("legenda-vento");
    if (!alvo) return;

    const cores = rampaVento();
    alvo.innerHTML = VENTO_ROTULOS.map(function (rotulo, k) {
      return [
        '<div class="legend-item">',
        '  <dt><span class="legend-swatch legend-swatch-faixa" style="background-color: ',
        cores[Math.min(k, cores.length - 1)], '" aria-hidden="true"></span>',
        rotulo[0], "</dt>",
        "  <dd>", rotulo[1], "</dd>",
        "</div>",
      ].join("");
    }).join("");
  }

  function montarResumoVento() {
    const alvo = document.getElementById("vento-resumo");
    if (!alvo) return;

    const velocidades = ESTACOES.map(function (e) { return e.vento; });
    const soma = VENTOS.reduce(function (acc, w) {
      return [acc[0] + w.u, acc[1] + w.v];
    }, [0, 0]);
    const rumo = (Math.atan2(-soma[0], -soma[1]) * 180 / Math.PI + 360) % 360;

    alvo.textContent =
      "As setas apontam para onde o vento sopra, e a cor indica a " +
      "intensidade. Nas estações o vento vai de " +
      Math.min.apply(null, velocidades) + " a " +
      Math.max.apply(null, velocidades) + " km/h, predominando de " +
      rosaDosVentos(rumo) + ". Setas apagadas marcam rumo mal definido: " +
      "as estações próximas discordam entre si.";
  }

  mapa.on("zoomend moveend", desenharVento);
  camadaVento.on("add", desenharVento);

  if (typeof ClimaCampo !== "undefined") {
    const campo = ClimaCampo.construir({
      limites: LIMITES,
      malha: window.SP_GEOJSON,
      largura: 192,
      limiares: LIMIARES,
      avaliar: confiancaEm,
    });

    /* Cada faixa e a regiao acima do seu limiar com a regiao acima do limiar
       seguinte descontada. Passando os dois conjuntos de aneis ao mesmo
       poligono, fillRule evenodd transforma o interno em furo -- e o contorno
       externo da faixa mais baixa e a propria fronteira do Estado. */
    const aneisMalha = ClimaCampo.aneisDaMalha(window.SP_GEOJSON);

    const contornos = [aneisMalha, campo.aneis[0], campo.aneis[1], []];

    ["baixa", "media", "alta"].forEach(function (chave, k) {
      const faixa = L.polygon(contornos[k].concat(contornos[k + 1]), {
        renderer: tracadorCampo,
        pane: "campo",
        stroke: false,
        fillRule: "evenodd",
        fillOpacity: 0.55,
        interactive: false,
      });
      faixa.chaveConfianca = chave;
      faixasCampo.push(faixa);
      camadaConfianca.addLayer(faixa);
    });

    montarLegendaConfianca(campo.fracoes);

    /* Mesma montagem por regioes acumuladas, agora com treze faixas em vez de
       tres. A faixa mais baixa nao tem isolinha propria: o seu contorno
       externo e a fronteira do Estado, como la. */
    const campoTemp = ClimaCampo.construir({
      limites: LIMITES,
      malha: window.SP_GEOJSON,
      largura: 192,
      limiares: TEMP_LIMIARES,
      avaliar: temperaturaEm,
    });

    const coresTemp = rampaTemp();
    const contornosTemp = [aneisMalha].concat(campoTemp.aneis).concat([[]]);

    for (let k = 0; k < contornosTemp.length - 1; k++) {
      const externo = contornosTemp[k];
      const interno = contornosTemp[k + 1];

      /* Faixa vazia quando a temperatura nunca entra nela -- o caso da maior
         parte da escala em qualquer dia. Sem poligono, sem custo. */
      if (!externo.length && !interno.length) continue;

      const faixa = L.polygon(externo.concat(interno), {
        renderer: tracadorCampo,
        pane: "campo",
        stroke: false,
        fillRule: "evenodd",
        fillColor: corDaFaixaTemp(k, coresTemp),
        /* Mais opaco que o campo de confianca: aqui a cor e a propria
           medida, nao uma ressalva sobre ela. */
        fillOpacity: 0.7,
        interactive: false,
      });
      faixa.nivelTemp = k;
      faixasTemperatura.push(faixa);
      camadaTemperatura.addLayer(faixa);
    }

    /* O veu entra por ultimo no grupo, logo e o ultimo a ser desenhado no
       canvas: reaproveita a geometria da faixa de confianca baixa. */
    veuTemperatura = L.polygon(contornos[0].concat(contornos[1]), {
      renderer: tracadorCampo,
      pane: "campo",
      stroke: false,
      fillRule: "evenodd",
      fillColor: token("--c-bg", "#1F1F28"),
      fillOpacity: 0.72,
      interactive: false,
    });
    camadaTemperatura.addLayer(veuTemperatura);

    fracoesTemperatura = campoTemp.fracoes;
    montarLegendaTemperatura();
    montarResumoTemperatura(campo.fracoes[0]);
  }

  /* ---------------------------------------------------------------------
     Tema
     ---------------------------------------------------------------------
     O renderizador em canvas nao acompanha as classes do CSS. Ao trocar de
     tema, as variaveis sao relidas e reaplicadas as camadas vetoriais.
     script.js deve disparar o evento ao alternar Wave/Lotus.
     --------------------------------------------------------------------- */

  function aplicarTema() {
    const atual = getComputedStyle(document.documentElement);
    function cor(nome, reserva) {
      return atual.getPropertyValue(nome).trim() || reserva;
    }

    const linha = cor("--c-line", C_LINHA);

    /* O relevo segue a rampa altimetrica, nao a cor de linha: repintar tudo
       com --c-line aqui apagaria a escala na primeira troca de tema. */
    const rampa = rampaRelevo();
    faixasRelevo.forEach(function (f) {
      f.setStyle({ fillColor: corDoNivel(f.altitude, rampa) });
    });
    curvasRelevo.forEach(function (c) {
      c.setStyle({ color: corDoNivel(c.altitude, rampa) });
    });
    montarLegendaRelevo();

    const paleta = {
      alta: cor("--c-accent", CORES.alta),
      media: cor("--c-warn", CORES.media),
      baixa: cor("--c-alert", CORES.baixa),
    };
    faixasCampo.forEach(function (f) {
      f.setStyle({ fillColor: paleta[f.chaveConfianca] });
    });

    /* CORES e lido por criarMarcador: atualizado aqui, um novo renderizar()
       tambem nasce com as cores do tema atual. */
    Object.assign(CORES, paleta);
    const texto = cor("--c-fg", C_TEXTO);
    marcadores.forEach(function (marcador) {
      marcador.setStyle({ color: texto, fillColor: paleta[marcador.confianca] });
    });

    camadaMunicipios.setStyle({ color: linha });
    realceMunicipio.setStyle({ color: cor("--c-accent", CORES.alta) });

    /* O campo termico tem rampa propria, como o relevo, e o veu e sempre a
       cor da pagina -- as duas coisas mudam junto com o tema. */
    const rampaT = rampaTemp();
    faixasTemperatura.forEach(function (f) {
      f.setStyle({ fillColor: corDaFaixaTemp(f.nivelTemp, rampaT) });
    });
    if (veuTemperatura) {
      veuTemperatura.setStyle({ fillColor: cor("--c-bg", "#1F1F28") });
    }
    montarLegendaTemperatura();

    /* As setas sao tracadas em canvas com a cor ja resolvida: trocar de tema
       exige redesenha-las, nao basta reler a variavel. */
    montarLegendaVento();
    desenharVento();

    /* Com a hipsometria ligada, a malha deixa de ser superficie e passa a ser
       a faixa de 0 a INTERVALO_RELEVO metros -- a unica que nao tem anel
       proprio, porque o seu contorno externo e a fronteira do Estado. */
    const hipsometria = document.getElementById("camada-hipsometria");
    estado.setStyle({
      color: linha,
      fillColor:
        hipsometria && hipsometria.checked
          ? rampa[0]
          : cor("--c-surface", C_SUPERFICIE),
    });
  }

  aplicarTema();
  window.addEventListener("climasp:tema", aplicarTema);

  /* ---------------------------------------------------------------------
     Camadas alternaveis
     ---------------------------------------------------------------------
     CAMADAS corresponde as caixas de selecao (sobreposicoes que se somam),
     CAMPOS as opcoes de radio (campos continuos, que se excluem: dois campos
     coloridos empilhados nao se leem).
     --------------------------------------------------------------------- */

  const camadaEstacoes = L.layerGroup();

  const CAMADAS = {
    estacoes: camadaEstacoes,
    vento: camadaVento,
    municipios: camadaMunicipios,
    hipsometria: camadaHipsometria,
    curvas: camadaCurvas,
  };

  const CAMPOS = {
    temperatura: camadaTemperatura,
    confianca: camadaConfianca,
  };
  const LEGENDAS = {
    temperatura: "bloco-temperatura",
    confianca: "bloco-confianca",
  };

  /* LEGENDAS vale para as opcoes de radio; estas sao as legendas das caixas
     de selecao, que aparecem e somem junto com a sua propria camada. */
  const LEGENDAS_CAMADA = { vento: "bloco-vento" };

  const caixas = document.querySelectorAll("[data-camada]");

  /* A escala altimetrica so faz sentido com alguma camada de relevo no ar, e
     a faixa mais baixa mora na malha do Estado: as duas coisas mudam junto
     com as caixas de selecao. */
  function atualizarRelevo() {
    const hipsometria = document.getElementById("camada-hipsometria");
    const curvas = document.getElementById("camada-curvas");
    const ativo =
      (hipsometria && hipsometria.checked) || (curvas && curvas.checked);

    const bloco = document.getElementById("bloco-relevo");
    if (bloco) bloco.hidden = !ativo || !window.SP_RELEVO;

    const rampa = rampaRelevo();
    estado.setStyle({
      fillColor:
        hipsometria && hipsometria.checked
          ? rampa[0]
          : token("--c-surface", C_SUPERFICIE),
    });
  }

  function aplicar(caixa) {
    const nome = caixa.dataset.camada;
    const camada = CAMADAS[nome];
    if (camada) {
      if (caixa.checked) {
        mapa.addLayer(camada);
      } else {
        mapa.removeLayer(camada);
      }
    }

    const bloco = document.getElementById(LEGENDAS_CAMADA[nome]);
    if (bloco) bloco.hidden = !caixa.checked;

    atualizarRelevo();
  }

  caixas.forEach(function (caixa) {
    aplicar(caixa); /* respeita o atributo checked do HTML */
    caixa.addEventListener("change", function () {
      aplicar(caixa);
      if (status) {
        const rotulo = document.querySelector('label[for="' + caixa.id + '"]');
        status.textContent =
          (rotulo ? rotulo.textContent.trim() : caixa.id) +
          (caixa.checked ? ": camada ativada." : ": camada desativada.");
      }
    });
  });

  function aplicarCampo(opcao, silencioso) {
    Object.keys(CAMPOS).forEach(function (nome) {
      mapa.removeLayer(CAMPOS[nome]);
      const dl = document.getElementById(LEGENDAS[nome]);
      if (dl) dl.hidden = true;
    });

    /* Cada campo tem o seu bloco de legenda, e o resumo textual mora dentro
       dele: esconder o bloco ja esconde o resumo. */
    const camada = CAMPOS[opcao.value];

    if (camada) {
      mapa.addLayer(camada);
      const dl = document.getElementById(LEGENDAS[opcao.value]);
      if (dl) dl.hidden = false;
    }

    if (status && !silencioso) {
      const rotulo = document.querySelector('label[for="' + opcao.id + '"]');
      status.textContent =
        "Campo exibido: " + (rotulo ? rotulo.textContent.trim() : opcao.value) + ".";
    }
  }

  document.querySelectorAll("[data-campo]").forEach(function (opcao) {
    if (opcao.checked) aplicarCampo(opcao, true); /* sem anunciar na carga */
    opcao.addEventListener("change", function () {
      if (opcao.checked) aplicarCampo(opcao);
    });
  });

  /* O relevo vetorial e opcional: se relevo-sp.js nao foi gerado, as caixas
     sao desabilitadas em vez de ligar camadas vazias e deixar o usuario sem
     explicacao. */
  if (!window.SP_RELEVO) {
    ["camada-hipsometria", "camada-curvas"].forEach(function (id) {
      const caixa = document.getElementById(id);
      if (!caixa) return;
      caixa.checked = false;
      caixa.disabled = true;
      mapa.removeLayer(CAMADAS[caixa.dataset.camada]);
    });
    const aviso = document.getElementById("relevo-aviso");
    if (aviso) aviso.hidden = false;
  }

  /* Mesmo tratamento para a malha municipal: sem o arquivo, a caixa e o
     seletor ficam desabilitados com a razao a vista, em vez de nao responder
     e deixar o usuario procurando o proprio erro. */
  if (!window.SP_MUNICIPIOS) {
    const caixa = document.getElementById("camada-municipios");
    if (caixa) {
      caixa.checked = false;
      caixa.disabled = true;
      mapa.removeLayer(camadaMunicipios);
    }
    const seletor = document.getElementById("municipio-seletor");
    if (seletor) seletor.disabled = true;
    const aviso = document.getElementById("municipios-aviso");
    if (aviso) aviso.hidden = false;
  } else {
    mapa.attributionControl.addAttribution(
      'Divisas municipais: <a href="https://www.ibge.gov.br/">IBGE</a>'
    );
  }

  montarSeletorMunicipios();
  montarResumoVento();

  /* ---------------------------------------------------------------------
     Renderizacao das estacoes
     --------------------------------------------------------------------- */

  function formatarHora(iso) {
    return new Date(iso).toLocaleString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function criarCartao(estacao) {
    const item = document.createElement("li");
    item.innerHTML = [
      '<article class="station-card" id="estacao-' + estacao.id + '" tabindex="-1">',
      "  <h3>" + estacao.nome + "</h3>",
      '  <p class="station-card-meta">' + estacao.fonte + " &middot; confiança " + ROTULO_NIVEL[estacao.confianca] + "</p>",
      '  <dl class="station-readings">',
      "    <dt>Temperatura</dt><dd>" + estacao.temperatura.toFixed(1) + " &deg;C</dd>",
      "    <dt>Vento</dt><dd>" + estacao.vento + " km/h de " + rosaDosVentos(estacao.direcao) + "</dd>",
      "    <dt>Chuva (1 h)</dt><dd>" + estacao.chuva.toFixed(1) + " mm</dd>",
      "  </dl>",
      '  <p class="station-card-meta">Atualizado às <time datetime="' + estacao.atualizadoEm + '">' + formatarHora(estacao.atualizadoEm) + "</time></p>",
      "</article>",
    ].join("");
    return item;
  }

  function criarMarcador(estacao) {
    const marcador = L.circleMarker([estacao.lat, estacao.lon], {
      radius: 8,
      weight: 2,
      color: C_TEXTO,
      fillColor: CORES[estacao.confianca],
      fillOpacity: 0.95,
    });

    /* Guardado para que aplicarTema saiba repintar o marcador. */
    marcador.confianca = estacao.confianca;

    marcador.bindPopup(
      "<strong>" + estacao.nome + "</strong><br>" +
        estacao.temperatura.toFixed(1) + " &deg;C &middot; " + estacao.vento +
        " km/h de " + rosaDosVentos(estacao.direcao)
    );

    marcador.on("click", function () {
      selecionar(estacao);
    });

    return marcador;
  }

  /* Clicar no marcador leva o foco ao cartao correspondente e anuncia a
     selecao na regiao viva: o mapa deixa de ser a unica via de leitura. */
  function selecionar(estacao) {
    const cartao = document.getElementById("estacao-" + estacao.id);
    if (cartao) {
      cartao.scrollIntoView({ block: "nearest" });
      cartao.focus();
    }
    if (status) {
      status.textContent =
        "Estação selecionada: " + estacao.nome + ", " +
        estacao.temperatura.toFixed(1) + " graus Celsius.";
    }
  }

  function renderizar(estacoes) {
    camadaEstacoes.clearLayers();
    marcadores.clear();
    if (lista) lista.textContent = "";

    estacoes.forEach(function (estacao) {
      marcadores.set(estacao.id, criarMarcador(estacao).addTo(camadaEstacoes));
      if (lista) lista.appendChild(criarCartao(estacao));
    });

    if (listaStatus) {
      listaStatus.textContent = estacoes.length + " estações exibidas no mapa.";
    }
  }

  renderizar(ESTACOES);
})();
