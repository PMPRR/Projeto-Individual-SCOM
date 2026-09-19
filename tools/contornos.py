#!/usr/bin/env python3
"""Curvas de nivel do Estado de Sao Paulo, a partir do MDE TOPODATA.

Gera assets/data/relevo-sp.js, que define window.SP_RELEVO com os aneis
fechados das regioes {altitude >= t} para t = 200, 400, ... metros.

O mesmo conjunto de aneis serve as duas camadas do mapa:

    preenchidos  ->  hipsometria (faixas altimetricas)
    tracados     ->  curvas de nivel

Nao se gera duas geometrias: uma faixa altimetrica e o contorno dela pintado
por dentro. No navegador as duas camadas compartilham os mesmos vetores.

Por que curvas e nao o sombreamento vetorizado: o sombreamento e funcao do
gradiente da altitude, e derivar amplifica a estrutura de alta frequencia --
cada micro-esporao da Serra do Mar e cada ruido do SRTM viram uma fronteira
entre niveis de cinza. Os conjuntos de nivel da altitude em si sao ordens de
grandeza mais simples. Vetorizar o hillshade custaria centenas de milhares de
vertices; vetorizar a altitude custa alguns milhares.

Chamado por build-sp-geo.py --contornos. Depende de numpy e de
fonte_topodata.py, como o passo do relevo.
"""

import json
import math
from pathlib import Path

import numpy

import fonte_topodata

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "assets" / "data" / "relevo-sp.js"
CACHE = Path(__file__).resolve().parent / ".cache"

# Area coberta. Igual a BBOX_RELEVO de build-sp-geo.py. Ordem: O, S, L, N.
BBOX = (-53.12, -25.32, -44.15, -19.77)

# Intervalo entre curvas, em metros. 200 m e o padrao das cartas topograficas
# do IBGE nesta escala: resolve a Mantiqueira e o degrau da Serra do Mar sem
# encher o Planalto Ocidental de linhas.
INTERVALO = 200

# Ponto culminante do Estado: Pedra da Mina, 2798 m.
ALTITUDE_MAX = 2800

# Resolucao da grade em graus. 0,008 grau e cerca de 890 m, proxima da
# resolucao efetiva do PNG de relevo ja gerado. Pedir mais detalhe que a
# fonte tem so acrescenta ruido ao traco.
RESOLUCAO = 0.008

# Tolerancia do Douglas-Peucker, em graus. 0,003 grau e cerca de 330 m: bem
# abaixo do tamanho da celula, logo a simplificacao nao inventa nem apaga
# nada que a fonte realmente resolva.
EPS = 0.003

# Aneis menores que isto saem do arquivo (graus quadrados). A Serra do Mar
# produz milhares de manchas de uma ou duas celulas que, no zoom util do
# mapa, nao chegam a um pixel.
AREA_MIN = 0.0003

# Casas decimais das coordenadas. 4 casas sao cerca de 11 m.
PRECISAO = 4

# Altitude atribuida a tudo que esta fora do Estado. Como e menor que
# qualquer limiar, nenhuma curva e gerada na fronteira: as faixas nunca
# acompanham o litoral por acidente, so onde a encosta realmente mergulha no
# mar.
FORA = -1000.0


# ============================================================================
# Mascara do Estado
# ============================================================================


def mascara_estado(poligonos, bbox, largura, altura):
    """Booleano (altura, largura): verdadeiro dentro do Estado.

    Varredura por numero de cruzamentos, linha a linha. Aneis internos
    (furos) invertem a paridade sozinhos, sem tratamento especial.
    """
    oeste, sul, leste, norte = bbox
    passo_lon = (leste - oeste) / largura
    passo_lat = (norte - sul) / altura

    dentro = numpy.zeros((altura, largura), dtype=bool)
    colunas = oeste + (numpy.arange(largura) + 0.5) * passo_lon

    # Todas as arestas de todos os aneis, achatadas em quatro vetores.
    x0, y0, x1, y1 = [], [], [], []
    for poligono in poligonos:
        for anel in poligono:
            for k in range(len(anel) - 1):
                x0.append(anel[k][0])
                y0.append(anel[k][1])
                x1.append(anel[k + 1][0])
                y1.append(anel[k + 1][1])

    x0 = numpy.array(x0)
    y0 = numpy.array(y0)
    x1 = numpy.array(x1)
    y1 = numpy.array(y1)

    for j in range(altura):
        lat = norte - (j + 0.5) * passo_lat

        # Arestas que cruzam esta latitude, com a regra semiaberta de sempre
        # (um extremo conta, o outro nao) para nao contar vertices duas vezes.
        corta = ((y0 <= lat) & (y1 > lat)) | ((y1 <= lat) & (y0 > lat))
        if not corta.any():
            continue

        t = (lat - y0[corta]) / (y1[corta] - y0[corta])
        cruzamentos = x0[corta] + t * (x1[corta] - x0[corta])
        cruzamentos.sort()

        # Paridade: par de cruzamentos a esquerda -> fora; impar -> dentro.
        indices = numpy.searchsorted(cruzamentos, colunas, side="right")
        dentro[j] = (indices % 2) == 1

    return dentro


# ============================================================================
# Marching squares
# ============================================================================

# Arestas da celula: T superior (a-b), R direita (b-c), B inferior (d-c),
# L esquerda (a-d). Cantos: a noroeste, b nordeste, c sudeste, d sudoeste.
#
# caso = 8*a + 4*b + 2*c + 1*d, com bit ligado quando o canto esta no nivel
# ou acima dele.
TABELA = {
    1: [("L", "B")],
    2: [("B", "R")],
    3: [("L", "R")],
    4: [("T", "R")],
    6: [("T", "B")],
    7: [("L", "T")],
    8: [("L", "T")],
    9: [("T", "B")],
    11: [("T", "R")],
    12: [("L", "R")],
    13: [("B", "R")],
    14: [("L", "B")],
}


def _ponto(aresta, i, j, a, b, c, d, nivel, oeste, norte, passo_lon, passo_lat):
    """Interpola a travessia do nivel sobre uma aresta da celula."""
    if aresta == "T":
        t = (nivel - a) / (b - a)
        return (oeste + (i + t) * passo_lon, norte - j * passo_lat)
    if aresta == "B":
        t = (nivel - d) / (c - d)
        return (oeste + (i + t) * passo_lon, norte - (j + 1) * passo_lat)
    if aresta == "L":
        t = (nivel - a) / (d - a)
        return (oeste + i * passo_lon, norte - (j + t) * passo_lat)
    t = (nivel - b) / (c - b)
    return (oeste + (i + 1) * passo_lon, norte - (j + t) * passo_lat)


def segmentos(grade, nivel, bbox):
    """Segmentos da isolinha `nivel`, em coordenadas (lon, lat)."""
    oeste, sul, leste, norte = bbox
    altura, largura = grade.shape
    passo_lon = (leste - oeste) / (largura - 1)
    passo_lat = (norte - sul) / (altura - 1)

    acima = grade >= nivel
    casos = (
        acima[:-1, :-1].astype(numpy.uint8) * 8
        + acima[:-1, 1:].astype(numpy.uint8) * 4
        + acima[1:, 1:].astype(numpy.uint8) * 2
        + acima[1:, :-1].astype(numpy.uint8)
    )

    linhas, colunas = numpy.nonzero((casos > 0) & (casos < 15))
    saida = []

    for j, i in zip(linhas.tolist(), colunas.tolist()):
        caso = int(casos[j, i])
        a = float(grade[j, i])
        b = float(grade[j, i + 1])
        c = float(grade[j + 1, i + 1])
        d = float(grade[j + 1, i])

        if caso in (5, 10):
            # Sela: as duas diagonais opostas estao acima do nivel e a ligacao
            # e ambigua. Decide-se pela media dos quatro cantos -- se o centro
            # tambem esta acima, os cantos altos se conectam.
            centro = (a + b + c + d) / 4.0
            alto = centro >= nivel
            if caso == 5:
                pares = [("L", "T"), ("B", "R")] if alto else [("L", "B"), ("T", "R")]
            else:
                pares = [("L", "B"), ("T", "R")] if alto else [("L", "T"), ("B", "R")]
        else:
            pares = TABELA[caso]

        for origem, destino in pares:
            p = _ponto(origem, i, j, a, b, c, d, nivel, oeste, norte, passo_lon, passo_lat)
            q = _ponto(destino, i, j, a, b, c, d, nivel, oeste, norte, passo_lon, passo_lat)
            saida.append((p, q))

    return saida


# ============================================================================
# Montagem dos aneis
# ============================================================================


def montar_aneis(segs):
    """Encadeia os segmentos em aneis fechados.

    Cada ponto de travessia pertence a exatamente duas celulas vizinhas, logo
    todo vertice tem grau 2 e o encadeamento nao precisa de direcao: basta
    seguir de vizinho em vizinho ate voltar ao inicio.
    """
    vizinhos = {}

    def chave(p):
        return (round(p[0], 9), round(p[1], 9))

    for p, q in segs:
        vizinhos.setdefault(chave(p), []).append(chave(q))
        vizinhos.setdefault(chave(q), []).append(chave(p))

    visitados = set()
    aneis = []

    for inicio in vizinhos:
        if inicio in visitados:
            continue

        anel = [inicio]
        visitados.add(inicio)
        atual = inicio
        anterior = None

        while True:
            seguintes = [p for p in vizinhos[atual] if p != anterior]
            if not seguintes:
                break
            proximo = seguintes[0]
            if proximo == inicio:
                break
            if proximo in visitados:
                break
            anel.append(proximo)
            visitados.add(proximo)
            anterior, atual = atual, proximo

        if len(anel) >= 4:
            anel.append(anel[0])  # fecha
            aneis.append(anel)

    return aneis


def area(anel):
    """Area pela formula do cadarco, em graus quadrados."""
    total = 0.0
    for k in range(len(anel) - 1):
        x0, y0 = anel[k]
        x1, y1 = anel[k + 1]
        total += x0 * y1 - x1 * y0
    return abs(total) / 2.0


def douglas_peucker(pontos, eps):
    """Simplificacao iterativa, sem recursao: os aneis da Serra do Mar chegam
    a alguns milhares de pontos e estourariam a pilha do interpretador."""
    if len(pontos) < 3:
        return list(pontos)

    manter = [False] * len(pontos)
    manter[0] = manter[-1] = True
    pilha = [(0, len(pontos) - 1)]

    while pilha:
        inicio, fim = pilha.pop()
        if fim <= inicio + 1:
            continue

        x0, y0 = pontos[inicio]
        x1, y1 = pontos[fim]
        dx, dy = x1 - x0, y1 - y0
        norma = math.hypot(dx, dy)

        pior, distancia = -1, 0.0
        for k in range(inicio + 1, fim):
            x, y = pontos[k]
            if norma == 0:
                d = math.hypot(x - x0, y - y0)
            else:
                d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / norma
            if d > distancia:
                pior, distancia = k, d

        if distancia > eps:
            manter[pior] = True
            pilha.append((inicio, pior))
            pilha.append((pior, fim))

    return [p for p, fica in zip(pontos, manter) if fica]


# ============================================================================
# Construcao
# ============================================================================


def construir(poligonos, escrever=True):
    oeste, sul, leste, norte = BBOX
    largura = int(round((leste - oeste) / RESOLUCAO))
    altura = int(round((norte - sul) / RESOLUCAO))

    print("Baixando altitudes do TOPODATA/INPE...")
    grade = fonte_topodata.montar(
        BBOX, RESOLUCAO, CACHE / "topodata", poligonos=poligonos
    )

    # A grade vem no tamanho que o mosaico produziu; a mascara acompanha.
    altura, largura = grade.shape
    print("Recortando pelo contorno do Estado (%d x %d)..." % (largura, altura))
    dentro = mascara_estado(poligonos, BBOX, largura, altura)
    grade = numpy.where(dentro, grade, FORA).astype(numpy.float32)

    niveis = []
    total_pontos = 0

    for altitude in range(INTERVALO, ALTITUDE_MAX + 1, INTERVALO):
        segs = segmentos(grade, float(altitude), BBOX)
        if not segs:
            continue

        aneis = []
        for anel in montar_aneis(segs):
            if area(anel) < AREA_MIN:
                continue
            simples = douglas_peucker(anel, EPS)
            if len(simples) < 4:
                continue
            if simples[0] != simples[-1]:
                simples.append(simples[0])
            # [lat, lon]: e o que L.polygon consome. Converter no navegador
            # custaria uma passada sobre dezenas de milhares de pontos a cada
            # carregamento da pagina.
            aneis.append(
                [[round(y, PRECISAO), round(x, PRECISAO)] for x, y in simples]
            )

        if not aneis:
            continue

        pontos = sum(len(a) for a in aneis)
        total_pontos += pontos
        niveis.append({"altitude": altitude, "aneis": aneis})
        print("  %4d m: %3d aneis, %6d pontos" % (altitude, len(aneis), pontos))

    resultado = {"intervalo": INTERVALO, "niveis": niveis}
    corpo = json.dumps(resultado, separators=(",", ":"))

    cabecalho = (
        "/* Gerado por tools/build-sp-geo.py --contornos. Nao editar a mao.\n"
        "   Fonte: MDE TOPODATA (INPE), SRTM refinado por krigagem.\n"
        "   Regioes {altitude >= t}, t = %d, %d, ... m. Coordenadas [lat, lon].\n"
        "   Simplificacao: Douglas-Peucker, tolerancia %s grau. */\n\n"
        "window.SP_RELEVO = " % (INTERVALO, INTERVALO * 2, EPS)
    )

    if escrever:
        SAIDA.parent.mkdir(parents=True, exist_ok=True)
        SAIDA.write_text(cabecalho + corpo + ";\n", encoding="utf-8")
        print(
            "%s: %d niveis, %d pontos, %.1f kB"
            % (
                SAIDA.relative_to(RAIZ),
                len(niveis),
                total_pontos,
                len(corpo) / 1024,
            )
        )

    return resultado
