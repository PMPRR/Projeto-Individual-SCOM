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
       marcadores                              z 600

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
     de tudo, e qualquer sobreposicao cai por cima sem depender da ordem em
     que as camadas foram adicionadas. */
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

  if (window.SP_RELEVO) {
    window.SP_RELEVO.niveis.forEach(function (nivel) {
      /* As regioes sao acumuladas e portanto encaixadas umas nas outras.
         Pintadas da mais baixa para a mais alta com opacidade pequena, a
         sobreposicao produz o degrade altimetrico sozinha -- sem rampa de
         cores e sem acrescentar nenhuma cor a interface.

         fillRule evenodd resolve de brinde o caso raro de uma depressao
         fechada acima do limiar: o anel interno vira furo. */
      const faixa = L.polygon(nivel.aneis, {
        renderer: tracadorRelevo,
        pane: "relevo",
        stroke: false,
        fillRule: "evenodd",
        fillOpacity: 0.06,
        interactive: false,
      });

      /* Mesmo array de aneis, outro estilo: as curvas de nivel sao o contorno
         das faixas. */
      const curva = L.polygon(nivel.aneis, {
        renderer: tracadorRelevo,
        pane: "relevo",
        weight: 0.6,
        opacity: 0.75,
        fill: false,
        interactive: false,
      });

      faixasRelevo.push(faixa);
      curvasRelevo.push(curva);
      camadaHipsometria.addLayer(faixa);
      camadaCurvas.addLayer(curva);
    });

    mapa.attributionControl.addAttribution(
      'Altimetria: <a href="http://www.dsr.inpe.br/topodata/">TOPODATA/INPE</a>'
    );
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
     na pagina, com as mesmas tres variaveis de cor. Quatro estacoes tambem
     nao sustentam cinco niveis de precisao.
     --------------------------------------------------------------------- */

  const QUALIDADE = { alta: 0.95, media: 0.7, baixa: 0.4 };
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
      ["baixa", "Confianca baixa", "Nenhuma estacao proxima o bastante."],
      ["media", "Confianca media", "Uma estacao proxima, ou varias distantes."],
      ["alta", "Confianca alta", "Evidencia suficiente para interpolar."],
    ];

    if (alvo) {
      alvo.innerHTML = rotulos.map(function (linha, k) {
        return [
          '<div class="legend-item">',
          '  <dt><span class="legend-swatch legend-swatch-faixa" style="background-color: ',
          CORES[linha[0]], '" aria-hidden="true"></span>', linha[1], "</dt>",
          "  <dd>", linha[2], " ", Math.round(fracoes[k] * 100), "% do territorio.</dd>",
          "</div>",
        ].join("");
      }).join("");
    }

    /* As porcentagens sao o equivalente textual do campo: quem nao distingue
       as cores le a mesma informacao em numeros. */
    if (resumo) {
      resumo.textContent =
        "Cobertura confiavel em " + Math.round(fracoes[2] * 100) +
        "% do territorio; em " + Math.round(fracoes[0] * 100) +
        "% nao ha estacao proxima o bastante para sustentar a interpolacao.";
    }
  }

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
    const contornos = [
      ClimaCampo.aneisDaMalha(window.SP_GEOJSON),
      campo.aneis[0],
      campo.aneis[1],
      [],
    ];

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
    faixasRelevo.forEach(function (f) { f.setStyle({ fillColor: linha }); });
    curvasRelevo.forEach(function (c) { c.setStyle({ color: linha }); });

    const paleta = {
      alta: cor("--c-accent", CORES.alta),
      media: cor("--c-warn", CORES.media),
      baixa: cor("--c-alert", CORES.baixa),
    };
    faixasCampo.forEach(function (f) {
      f.setStyle({ fillColor: paleta[f.chaveConfianca] });
    });

    estado.setStyle({
      color: linha,
      fillColor: cor("--c-surface", C_SUPERFICIE),
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
    hipsometria: camadaHipsometria,
    curvas: camadaCurvas,
  };

  const CAMPOS = { confianca: camadaConfianca };
  const LEGENDAS = { confianca: "legenda-confianca" };

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

  function aplicarCampo(opcao, silencioso) {
    Object.keys(CAMPOS).forEach(function (nome) {
      mapa.removeLayer(CAMPOS[nome]);
      const dl = document.getElementById(LEGENDAS[nome]);
      if (dl) dl.hidden = true;
    });

    const resumo = document.getElementById("campo-resumo");
    const camada = CAMPOS[opcao.value];

    if (camada) {
      mapa.addLayer(camada);
      const dl = document.getElementById(LEGENDAS[opcao.value]);
      if (dl) dl.hidden = false;
    }
    if (resumo) resumo.hidden = !camada;

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
