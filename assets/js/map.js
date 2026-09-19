/* ==========================================================================
   Mapa interativo das estacoes meteorologicas
   --------------------------------------------------------------------------
   Nao ha camada de ladrilhos: a base e a malha do Estado desenhada a partir
   de sp-geo.js. Assim a pagina abre por file:// sem depender de nenhum
   servico externo (a OSM exige cabecalho Referer e a CARTO passou a exigir
   chave de API; nenhum dos dois funciona em arquivo local).

   Trabalho I: ESTACOES simula a resposta do backend. No Trabalho II ela sera
   substituida por um fetch em GET /api/estacoes mantendo o mesmo formato de
   objeto, de modo que o restante deste arquivo nao precise mudar.
   ========================================================================== */

(function () {
  "use strict";

  const el = document.getElementById("map");
  if (!el || typeof L === "undefined") return;

  /* Cores da legenda definidas em map.css. Sao lidas das variaveis CSS para
     que o mapa acompanhe os temas Wave e Lotus sem duplicar valores. */
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

  /* TODO(Trabalho II): substituir por fetch("/api/estacoes"). */
  const ESTACOES = [
    {
      id: "sor-01",
      nome: "Sorocaba - ICTS",
      cidade: "Sorocaba",
      fonte: "Estacao privada",
      lat: -23.5015,
      lon: -47.4526,
      temperatura: 24.1,
      vento: 12,
      chuva: 0.0,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "spo-01",
      nome: "Sao Paulo - Mirante de Santana",
      cidade: "Sao Paulo",
      fonte: "INMET",
      lat: -23.4961,
      lon: -46.6199,
      temperatura: 22.7,
      vento: 9,
      chuva: 1.2,
      confianca: "alta",
      atualizadoEm: "2026-09-18T09:00:00-03:00",
    },
    {
      id: "cps-01",
      nome: "Campinas - Barao Geraldo",
      cidade: "Campinas",
      fonte: "Estacao privada",
      lat: -22.8184,
      lon: -47.0647,
      temperatura: 26.3,
      vento: 7,
      chuva: 0.0,
      confianca: "media",
      atualizadoEm: "2026-09-18T08:00:00-03:00",
    },
    {
      id: "rpt-01",
      nome: "Ribeirao Preto - Centro",
      cidade: "Ribeirao Preto",
      fonte: "Colaborativa",
      lat: -21.1775,
      lon: -47.8103,
      temperatura: 29.8,
      vento: 4,
      chuva: 0.0,
      confianca: "baixa",
      atualizadoEm: "2026-09-18T05:00:00-03:00",
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
     de tudo, e qualquer sobreposicao futura cai por cima sem depender da
     ordem em que as camadas foram adicionadas. */
  mapa.createPane("base");
  mapa.getPane("base").style.zIndex = 300;

  mapa.attributionControl.addAttribution(
    'Malha territorial: <a href="https://www.ibge.gov.br/">IBGE</a>'
  );

  if (!window.SP_GEOJSON) {
    if (status) status.textContent = "Nao foi possivel carregar a malha do Estado.";
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
     Camadas alternaveis
     ---------------------------------------------------------------------
     Cada entrada de CAMADAS corresponde a uma caixa de selecao no HTML,
     ligada pelo atributo data-camada. Acrescentar uma sobreposicao nova
     (temperatura, chuva, confianca) e acrescentar uma entrada aqui e um
     input la.
     --------------------------------------------------------------------- */

  /* Extensao geografica da imagem de relevo. Precisa ser exatamente a mesma
     usada ao gerar o PNG, senao o raster nao coincide com a malha. */
  const RELEVO_LIMITES = L.latLngBounds([-25.32, -53.12], [-19.77, -44.15]);
  const RELEVO_URL = "../assets/img/relevo-sp.png";

  const camadaEstacoes = L.layerGroup();
  const camadaRelevo = L.imageOverlay(RELEVO_URL, RELEVO_LIMITES, {
    opacity: 0.85,
    alt: "Sombreamento do relevo do Estado de Sao Paulo",
  });

  const CAMADAS = {
    estacoes: camadaEstacoes,
    relevo: camadaRelevo,
  };

  const caixas = document.querySelectorAll("[data-camada]");

  function aplicar(caixa) {
    const camada = CAMADAS[caixa.dataset.camada];
    if (!camada) return;
    if (caixa.checked) {
      mapa.addLayer(camada);
    } else {
      mapa.removeLayer(camada);
    }
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

  /* O PNG de relevo e opcional. Se nao existir, a caixa e desabilitada em vez
     de ligar uma camada invisivel e deixar o usuario sem explicacao. */
  const caixaRelevo = document.getElementById("camada-relevo");
  const avisoRelevo = document.getElementById("camada-relevo-aviso");
  if (caixaRelevo) {
    const sonda = new Image();
    sonda.addEventListener("error", function () {
      caixaRelevo.checked = false;
      caixaRelevo.disabled = true;
      mapa.removeLayer(camadaRelevo);
      if (avisoRelevo) avisoRelevo.hidden = false;
    });
    sonda.src = RELEVO_URL;
  }

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
      '  <p class="station-card-meta">' + estacao.fonte + " &middot; confianca " + estacao.confianca + "</p>",
      '  <dl class="station-readings">',
      "    <dt>Temperatura</dt><dd>" + estacao.temperatura.toFixed(1) + " &deg;C</dd>",
      "    <dt>Vento</dt><dd>" + estacao.vento + " km/h</dd>",
      "    <dt>Chuva (1 h)</dt><dd>" + estacao.chuva.toFixed(1) + " mm</dd>",
      "  </dl>",
      '  <p class="station-card-meta">Atualizado as <time datetime="' + estacao.atualizadoEm + '">' + formatarHora(estacao.atualizadoEm) + "</time></p>",
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

    marcador.bindPopup(
      "<strong>" + estacao.nome + "</strong><br>" +
        estacao.temperatura.toFixed(1) + " &deg;C &middot; " + estacao.vento + " km/h"
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
        "Estacao selecionada: " + estacao.nome + ", " +
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
      listaStatus.textContent = estacoes.length + " estacoes exibidas no mapa.";
    }
  }

  renderizar(ESTACOES);
})();
