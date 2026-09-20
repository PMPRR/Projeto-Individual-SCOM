/* ==========================================================================
   Campos continuos vetoriais sobre o Estado
   --------------------------------------------------------------------------
   Avalia uma funcao ponto a ponto sobre uma grade e devolve os aneis fechados
   das regioes {valor >= limiar}, prontos para virar L.polygon. Nada de
   imagem: o campo e vetor, logo acompanha qualquer zoom e muda de cor com o
   tema sem ser recalculado.

   Regioes acumuladas, e nao faixas isoladas: {v >= t1} contem {v >= t2}
   sempre que t1 < t2. Quem monta a camada passa os dois conjuntos de aneis
   ao mesmo L.polygon com fillRule "evenodd", e o anel interno vira furo
   sozinho -- sem tratar orientacao, sem detectar aninhamento.

   Tudo que esta fora do Estado recebe um valor sentinela abaixo de qualquer
   limiar. Assim nenhuma isolinha e gerada na fronteira e as faixas nunca
   acompanham o litoral por acidente.

   Exposto como window.ClimaCampo. Sem dependencias: carregar antes de map.js.
   ========================================================================== */

(function (global) {
  "use strict";

  const GRAUS = Math.PI / 180;
  const KM_LAT = 110.574;
  const KM_LON = 111.320;

  /* Menor que qualquer limiar util. */
  const FORA = -1e6;

  /* --- Geometria auxiliar -------------------------------------------------- */

  /* Equirretangular: sobre algumas centenas de quilometros o erro contra
     haversine fica abaixo de 0,1%, e custa uma raiz em vez de quatro funcoes
     trigonometricas por estacao e por no da grade. */
  function distanciaKm(lat1, lon1, lat2, lon2) {
    const media = ((lat1 + lat2) / 2) * GRAUS;
    const dx = (lon2 - lon1) * KM_LON * Math.cos(media);
    const dy = (lat2 - lat1) * KM_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* Aneis da malha em [lat, lon], o formato que o L.polygon consome. Serve de
     contorno externo da faixa mais baixa, que nao tem isolinha propria: ela
     comeca na fronteira do Estado. */
  function aneisDaMalha(malha) {
    const saida = [];
    ((malha && malha.features) || []).forEach(function (feicao) {
      const geometria = feicao.geometry;
      if (!geometria) return;
      const poligonos = geometria.type === "Polygon"
        ? [geometria.coordinates]
        : geometria.coordinates;
      poligonos.forEach(function (aneis) {
        aneis.forEach(function (anel) {
          saida.push(anel.map(function (p) { return [p[1], p[0]]; }));
        });
      });
    });
    return saida;
  }

  /* --- Mascara do Estado --------------------------------------------------- */

  /* O canvas preenche a malha muito mais barato que um teste de
     ponto-em-poligono no a no. A imagem nao e desenhada em lugar nenhum:
     serve so como tabela de dentro/fora. */
  const cacheMascara = {};

  function obterMascara(malha, limites, colunas, linhas, passo) {
    const chave = colunas + "x" + linhas;
    if (cacheMascara[chave]) return cacheMascara[chave];

    const oeste = limites.getWest();
    const norte = limites.getNorth();

    const tela = document.createElement("canvas");
    tela.width = colunas;
    tela.height = linhas;
    const ctx = tela.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();

    ((malha && malha.features) || []).forEach(function (feicao) {
      const geometria = feicao.geometry;
      if (!geometria) return;
      const poligonos = geometria.type === "Polygon"
        ? [geometria.coordinates]
        : geometria.coordinates;
      poligonos.forEach(function (aneis) {
        aneis.forEach(function (anel) {
          anel.forEach(function (ponto, k) {
            /* O no (i, j) cai no centro do pixel (i, j). */
            const x = (ponto[0] - oeste) / passo + 0.5;
            const y = (norte - ponto[1]) / passo + 0.5;
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.closePath();
        });
      });
    });

    ctx.fill("evenodd"); /* aneis internos viram furos */

    const pixels = ctx.getImageData(0, 0, colunas, linhas).data;
    const dentro = new Uint8Array(colunas * linhas);
    for (let k = 0; k < dentro.length; k++) {
      dentro[k] = pixels[k * 4 + 3] > 127 ? 1 : 0;
    }

    cacheMascara[chave] = dentro;
    return dentro;
  }

  /* --- Ponto dentro do Estado ---------------------------------------------- */

  /* A mascara acima resolve o caso de uma grade inteira. Para punhados de
     pontos avulsos -- as setas do campo de vento, por exemplo, que mudam de
     posicao a cada deslocamento do mapa -- montar um canvas sairia mais caro
     que testar ponto a ponto.

     As arestas sao achatadas num unico Float64Array e guardadas por malha: o
     custo de percorrer a geometria e pago uma vez, nao a cada consulta. */
  const cacheArestas = new WeakMap();

  function arestasDe(malha) {
    if (cacheArestas.has(malha)) return cacheArestas.get(malha);

    const bruto = [];
    ((malha && malha.features) || []).forEach(function (feicao) {
      const geometria = feicao.geometry;
      if (!geometria) return;
      const poligonos = geometria.type === "Polygon"
        ? [geometria.coordinates]
        : geometria.coordinates;
      poligonos.forEach(function (aneis) {
        aneis.forEach(function (anel) {
          for (let i = 0; i < anel.length - 1; i++) {
            bruto.push(anel[i][0], anel[i][1], anel[i + 1][0], anel[i + 1][1]);
          }
        });
      });
    });

    const arestas = Float64Array.from(bruto);
    cacheArestas.set(malha, arestas);
    return arestas;
  }

  /* Numero de cruzamentos a esquerda: impar dentro, par fora. Aneis internos
     (furos) invertem a paridade sozinhos, sem tratamento especial. */
  function dentroDaMalha(malha, lat, lon) {
    const arestas = arestasDe(malha);
    let dentro = false;

    for (let i = 0; i < arestas.length; i += 4) {
      const x0 = arestas[i], y0 = arestas[i + 1];
      const x1 = arestas[i + 2], y1 = arestas[i + 3];
      if ((y0 > lat) !== (y1 > lat) &&
          lon < ((x1 - x0) * (lat - y0)) / (y1 - y0) + x0) {
        dentro = !dentro;
      }
    }
    return dentro;
  }

  /* --- Marching squares ---------------------------------------------------- */

  /* Arestas da celula: T superior, R direita, B inferior, L esquerda.
     Cantos: a noroeste, b nordeste, c sudeste, d sudoeste.
     caso = 8a + 4b + 2c + d, bit ligado quando o canto esta no limiar ou
     acima dele. Os casos 5 e 10 sao selas e ficam fora da tabela. */
  const TABELA = {
    1: [["L", "B"]], 2: [["B", "R"]], 3: [["L", "R"]], 4: [["T", "R"]],
    6: [["T", "B"]], 7: [["L", "T"]], 8: [["L", "T"]], 9: [["T", "B"]],
    11: [["T", "R"]], 12: [["L", "R"]], 13: [["B", "R"]], 14: [["L", "B"]],
  };

  function aneisDe(valores, colunas, linhas, limiar, oeste, norte, passo) {
    const nos = new Map();

    /* Chave inteira por aresta, e nao por coordenada: o ponto de travessia e
       compartilhado por duas celulas vizinhas e precisa produzir exatamente a
       mesma chave nas duas. Arredondar ponto flutuante nao garante isso;
       indexar a aresta, sim. */
    function no(aresta, i, j, a, b, c, d) {
      let t, lon, lat, id;
      if (aresta === "T") {
        t = (limiar - a) / (b - a);
        lon = oeste + (i + t) * passo; lat = norte - j * passo;
        id = "h:" + i + ":" + j;
      } else if (aresta === "B") {
        t = (limiar - d) / (c - d);
        lon = oeste + (i + t) * passo; lat = norte - (j + 1) * passo;
        id = "h:" + i + ":" + (j + 1);
      } else if (aresta === "L") {
        t = (limiar - a) / (d - a);
        lon = oeste + i * passo; lat = norte - (j + t) * passo;
        id = "v:" + i + ":" + j;
      } else {
        t = (limiar - b) / (c - b);
        lon = oeste + (i + 1) * passo; lat = norte - (j + t) * passo;
        id = "v:" + (i + 1) + ":" + j;
      }
      if (!nos.has(id)) nos.set(id, { pos: [lat, lon], ligacoes: [] });
      return id;
    }

    function ligar(p, q) {
      nos.get(p).ligacoes.push(q);
      nos.get(q).ligacoes.push(p);
    }

    for (let j = 0; j < linhas - 1; j++) {
      for (let i = 0; i < colunas - 1; i++) {
        const a = valores[j * colunas + i];
        const b = valores[j * colunas + i + 1];
        const c = valores[(j + 1) * colunas + i + 1];
        const d = valores[(j + 1) * colunas + i];

        const caso =
          (a >= limiar ? 8 : 0) + (b >= limiar ? 4 : 0) +
          (c >= limiar ? 2 : 0) + (d >= limiar ? 1 : 0);
        if (caso === 0 || caso === 15) continue;

        let pares;
        if (caso === 5 || caso === 10) {
          /* Sela: duas diagonais opostas acima do limiar, ligacao ambigua.
             Decide-se pela media dos quatro cantos. */
          const alto = (a + b + c + d) / 4 >= limiar;
          if (caso === 5) {
            pares = alto ? [["L", "T"], ["B", "R"]] : [["L", "B"], ["T", "R"]];
          } else {
            pares = alto ? [["L", "B"], ["T", "R"]] : [["L", "T"], ["B", "R"]];
          }
        } else {
          pares = TABELA[caso];
        }

        for (let k = 0; k < pares.length; k++) {
          ligar(
            no(pares[k][0], i, j, a, b, c, d),
            no(pares[k][1], i, j, a, b, c, d)
          );
        }
      }
    }

    /* Todo no tem grau 2, entao o encadeamento dispensa direcao: segue-se de
       vizinho em vizinho ate voltar ao inicio. */
    const visitados = new Set();
    const aneis = [];

    nos.forEach(function (_, inicio) {
      if (visitados.has(inicio)) return;

      const anel = [nos.get(inicio).pos];
      visitados.add(inicio);
      let atual = inicio;
      let anterior = null;

      for (;;) {
        const ligacoes = nos.get(atual).ligacoes;
        let proximo = null;
        for (let k = 0; k < ligacoes.length; k++) {
          if (ligacoes[k] !== anterior) { proximo = ligacoes[k]; break; }
        }
        if (proximo === null || proximo === inicio || visitados.has(proximo)) break;
        anel.push(nos.get(proximo).pos);
        visitados.add(proximo);
        anterior = atual;
        atual = proximo;
      }

      if (anel.length >= 4) aneis.push(anel);
    });

    return aneis;
  }

  /* --- Construcao ---------------------------------------------------------- */

  /*  opcoes:
        limites   L.latLngBounds do Estado
        malha     window.SP_GEOJSON
        largura   colunas da grade (as linhas saem da proporcao)
        limiares  valores crescentes, ex. [0.34, 0.67]
        avaliar   funcao (lat, lon) -> numero

      devolve:
        aneis     um conjunto de aneis por limiar, na mesma ordem
        fracoes   fracao da area do Estado em cada faixa (limiares + 1 valores)
  */
  function construir(opcoes) {
    const limites = opcoes.limites;
    const oeste = limites.getWest();
    const leste = limites.getEast();
    const norte = limites.getNorth();
    const sul = limites.getSouth();

    /* Grade em latitude e longitude lineares. Casar com Mercator so seria
       necessario para alinhar um raster; o vetor e reprojetado pelo proprio
       Leaflet. */
    const colunas = (opcoes.largura || 192) + 1;
    const passo = (leste - oeste) / (colunas - 1);
    const linhas = Math.max(2, Math.round((norte - sul) / passo) + 1);

    const dentro = obterMascara(opcoes.malha, limites, colunas, linhas, passo);
    const valores = new Float64Array(colunas * linhas);
    const limiares = opcoes.limiares;

    const pesos = new Array(limiares.length + 1).fill(0);
    let total = 0;

    for (let j = 0; j < linhas; j++) {
      const lat = norte - j * passo;
      /* A celula encolhe com o cosseno da latitude: sem esse peso, o sul do
         Estado contaria mais area do que tem. */
      const peso = Math.cos(lat * GRAUS);

      for (let i = 0; i < colunas; i++) {
        const indice = j * colunas + i;
        if (!dentro[indice]) {
          valores[indice] = FORA;
          continue;
        }

        const valor = opcoes.avaliar(lat, oeste + i * passo);
        valores[indice] = valor;

        let faixa = 0;
        while (faixa < limiares.length && valor >= limiares[faixa]) faixa++;
        pesos[faixa] += peso;
        total += peso;
      }
    }

    return {
      aneis: limiares.map(function (limiar) {
        return aneisDe(valores, colunas, linhas, limiar, oeste, norte, passo);
      }),
      fracoes: pesos.map(function (p) { return total ? p / total : 0; }),
    };
  }

  global.ClimaCampo = {
    construir: construir,
    aneisDaMalha: aneisDaMalha,
    dentroDaMalha: dentroDaMalha,
    distanciaKm: distanciaKm,
  };
})(window);
