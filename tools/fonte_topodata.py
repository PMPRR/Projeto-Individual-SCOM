#!/usr/bin/env python3
"""Fonte de altitudes TOPODATA (INPE) para o build-sp-geo.py.

TOPODATA e o modelo digital de elevacao do INPE: dados SRTM de 3 segundos de
arco refinados para 1 segundo (~30 m) por krigagem, em coordenadas geograficas
(EPSG:4326), altitudes ortometricas referidas ao geoide EGM96, organizados em
folhas de 1 grau de latitude por 1,5 grau de longitude (articulacao 1:250.000).

Atencao ao volume: cada folha tem cerca de 3601 x 5401 pixels em ponto
flutuante de 32 bits, ou seja ~78 MB, e o Estado de Sao Paulo e coberto por
cerca de 36 folhas. Por isso cada folha e reduzida assim que chega e apenas o
resultado reduzido fica em cache; o arquivo original e descartado.

O SRTM e um modelo digital de SUPERFICIE: em areas de vegetacao densa a
altitude corresponde ao topo do dossel, nao ao terreno.
"""

import math
import struct
import urllib.error
import urllib.request
import zlib
from pathlib import Path

import numpy

# Acervo do INPE (BIG/Brazil Data Cube). O endereco antigo,
# www.dsr.inpe.br/topodata/data/geotiff/, saiu do ar; os dados agora sao
# publicados como Cloud Optimized GeoTIFF sob data.inpe.br, com o catalogo
# STAC em https://data.inpe.br/bdc/stac/v1/collections/topodata-1.
# O caminho segue a folha: .../v001/23S/48_/23S48_ZN.tif
BASE_URL = "https://data.inpe.br/bdc/data/topodata/v001/"

# Sufixo do produto: ZN = altitude (o MDE propriamente dito). Outros sufixos do
# mesmo diretorio trazem derivacoes (declividade, orientacao de vertente etc.).
PRODUTO = "ZN"

# Resolucao nominal das folhas, em graus por pixel (1 segundo de arco).
RES_FOLHA = 1.0 / 3600.0


def listar_folhas(bbox):
    """Identificadores das folhas que cobrem a bbox (oeste, sul, leste, norte).

    O identificador combina a latitude e a longitude do canto noroeste, sem
    sinal nem separador decimal: a folha cujo canto e 23 S, 48,0 W e 23S48_,
    e a seguinte a leste e 23S465 (46,5 W). O sublinhado completa a largura
    fixa de seis caracteres quando a longitude e inteira.
    """
    oeste, sul, leste, norte = bbox
    folhas = []

    # Bordas das folhas: latitudes inteiras, longitudes em multiplos de 1,5.
    # O arredondamento vai para fora da bbox, senao a coluna mais a oeste e a
    # linha mais ao norte ficam descobertas.
    norte_folha = math.ceil(norte)
    while norte_folha > sul:
        oeste_folha = math.floor(oeste / 1.5) * 1.5
        while oeste_folha < leste:
            texto_lon = ("%g" % abs(oeste_folha)).replace(".", "")
            identificador = "%02d%s%s" % (
                abs(norte_folha),
                "S" if norte_folha <= 0 else "N",
                texto_lon.ljust(3, "_"),
            )
            folhas.append((identificador, oeste_folha, float(norte_folha)))
            oeste_folha += 1.5
        norte_folha -= 1

    return folhas


def url_folha(identificador):
    """Monta a URL da folha: o identificador se divide em linha e coluna.

    O identificador 23S48_ corresponde a linha 23S e a coluna 48_, e o
    arquivo fica em .../v001/23S/48_/23S48_ZN.tif
    """
    linha, coluna = identificador[:3], identificador[3:]
    return "%s%s/%s/%s%s.tif" % (BASE_URL, linha, coluna, identificador, PRODUTO)


def baixar_folha(identificador, destino):
    """Baixa uma folha para destino. Devolve False se ela nao existir (mar)."""
    url = url_folha(identificador)
    pedido = urllib.request.Request(
        url, headers={"User-Agent": "ClimaSP/1.0 (trabalho academico)"}
    )
    try:
        with urllib.request.urlopen(pedido, timeout=300) as resposta:
            destino.parent.mkdir(parents=True, exist_ok=True)
            with open(destino, "wb") as arquivo:
                while True:
                    pedaco = resposta.read(1 << 20)
                    if not pedaco:
                        break
                    arquivo.write(pedaco)
        return True
    except urllib.error.HTTPError as erro:
        if erro.code == 404:
            return False
        raise


# ---------------------------------------------------------------------------
# Leitura de GeoTIFF
# ---------------------------------------------------------------------------

TIPOS = {1: "B", 2: "B", 3: "H", 4: "I", 5: "II", 11: "f", 12: "d"}
TAMANHOS = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8}


def _campos(dados):
    """Le o primeiro IFD de um TIFF classico e devolve {tag: (tipo, valores)}."""
    if dados[:2] == b"II":
        ordem = "<"
    elif dados[:2] == b"MM":
        ordem = ">"
    else:
        raise ValueError("assinatura TIFF desconhecida")

    versao = struct.unpack(ordem + "H", dados[2:4])[0]
    if versao == 43:
        raise ValueError("BigTIFF nao suportado pelo leitor interno; use rasterio")
    if versao != 42:
        raise ValueError("versao TIFF inesperada: %d" % versao)

    inicio = struct.unpack(ordem + "I", dados[4:8])[0]
    quantidade = struct.unpack(ordem + "H", dados[inicio:inicio + 2])[0]
    campos = {}

    for k in range(quantidade):
        base = inicio + 2 + k * 12
        tag, tipo, contagem = struct.unpack(ordem + "HHI", dados[base:base + 8])
        if tipo not in TIPOS:
            continue

        bytes_totais = TAMANHOS[tipo] * contagem
        if bytes_totais <= 4:
            bruto = dados[base + 8:base + 8 + bytes_totais]
        else:
            deslocamento = struct.unpack(ordem + "I", dados[base + 8:base + 12])[0]
            bruto = dados[deslocamento:deslocamento + bytes_totais]

        if tipo == 5:  # RATIONAL: pares numerador/denominador
            pares = struct.unpack(ordem + "%dI" % (contagem * 2), bruto)
            valores = [
                pares[i] / pares[i + 1] if pares[i + 1] else 0.0
                for i in range(0, len(pares), 2)
            ]
        else:
            valores = list(
                struct.unpack(ordem + "%d%s" % (contagem, TIPOS[tipo]), bruto)
            )

        campos[tag] = valores

    return ordem, campos


def ler_geotiff(caminho):
    """Devolve (matriz float32, oeste, norte, passo_lon, passo_lat).

    Usa rasterio quando estiver instalado, porque cobre variacoes de formato
    que o leitor interno nao cobre (LZW, preditor de ponto flutuante,
    BigTIFF). O leitor interno atende TIFF classico em tiras ou blocos, sem
    compressao ou com deflate.
    """
    try:
        import rasterio

        with rasterio.open(caminho) as fonte:
            matriz = fonte.read(1).astype(numpy.float32)
            t = fonte.transform
            return matriz, t.c, t.f, t.a, -t.e
    except ImportError:
        pass

    dados = Path(caminho).read_bytes()
    ordem, campos = _campos(dados)

    largura = campos[256][0]
    altura = campos[257][0]
    bits = campos.get(258, [32])[0]
    compressao = campos.get(259, [1])[0]
    formato = campos.get(339, [3])[0]  # 3 = ponto flutuante
    preditor = campos.get(317, [1])[0]

    if bits != 32 or formato != 3:
        raise ValueError(
            "esperado float32; recebido %d bits, formato %d" % (bits, formato)
        )
    if preditor != 1:
        raise ValueError("preditor %d nao suportado; instale rasterio" % preditor)

    if 324 in campos:  # organizacao em blocos
        larg_bloco, alt_bloco = campos[322][0], campos[323][0]
        posicoes, tamanhos = campos[324], campos[325]
        blocos_por_linha = (largura + larg_bloco - 1) // larg_bloco
    else:  # organizacao em tiras
        larg_bloco = largura
        alt_bloco = campos.get(278, [altura])[0]
        posicoes, tamanhos = campos[273], campos[279]
        blocos_por_linha = 1

    matriz = numpy.zeros((altura, largura), dtype=numpy.float32)

    for indice, (posicao, tamanho) in enumerate(zip(posicoes, tamanhos)):
        bruto = dados[posicao:posicao + tamanho]
        if compressao in (8, 32946):
            bruto = zlib.decompress(bruto)
        elif compressao != 1:
            raise ValueError(
                "compressao %d nao suportada; instale rasterio" % compressao
            )

        bloco = numpy.frombuffer(bruto, dtype=(ordem + "f4"))
        linha = (indice // blocos_por_linha) * alt_bloco
        coluna = (indice % blocos_por_linha) * larg_bloco
        alt_util = min(alt_bloco, altura - linha)
        larg_util = min(larg_bloco, largura - coluna)

        bloco = bloco[: alt_bloco * larg_bloco].reshape(alt_bloco, larg_bloco)
        matriz[linha:linha + alt_util, coluna:coluna + larg_util] = bloco[
            :alt_util, :larg_util
        ]

    # Georreferenciamento: escala do pixel e ponto de amarracao do GeoTIFF.
    # Lidos do arquivo, e nao deduzidos do nome da folha.
    escala = campos.get(33550)
    amarracao = campos.get(33922)
    if not escala or not amarracao:
        raise ValueError("faltam as marcacoes de georreferenciamento do GeoTIFF")

    return matriz, amarracao[3], amarracao[4], escala[0], escala[1]


# ---------------------------------------------------------------------------
# Mosaico
# ---------------------------------------------------------------------------

def reduzir_bloco(matriz, fator):
    """Media de blocos fator x fator, completando a sobra das bordas.

    Cortar a sobra deixa cada folha alguns segundos mais estreita que os
    1,5 x 1,0 grau nominais. Como montar() posiciona cada folha pela
    geografia real, esse deficit se acumula e abre uma coluna (e uma linha)
    que nenhuma folha escreve. Completando a sobra as folhas se sobrepoem em
    uma celula, e a sobreposicao e inofensiva: quem escreve primeiro vence.
    """
    altura, largura = matriz.shape
    falta_y, falta_x = (-altura) % fator, (-largura) % fator
    if falta_y or falta_x:
        matriz = numpy.pad(matriz, ((0, falta_y), (0, falta_x)), mode="edge")
    altura, largura = matriz.shape
    return matriz.reshape(
        altura // fator, fator, largura // fator, fator
    ).mean(axis=(1, 3))


def _dentro(lon, lat, poligonos):
    """Ponto dentro do contorno, pela regra par-impar."""
    dentro = False
    for poligono in poligonos:
        for anel in poligono:
            for k in range(len(anel) - 1):
                x1, y1 = anel[k]
                x2, y2 = anel[k + 1]
                if (y1 > lat) != (y2 > lat):
                    corte = x1 + (lat - y1) / (y2 - y1) * (x2 - x1)
                    if lon < corte:
                        dentro = not dentro
    return dentro


def filtrar_folhas(folhas, poligonos):
    """Descarta as folhas que nao encostam no Estado.

    Das 49 folhas da bbox de Sao Paulo, boa parte cobre apenas Parana, Minas
    Gerais ou mar aberto. Como cada folha pesa dezenas de MB, vale o teste.

    Uma folha e mantida se algum vertice do contorno cair dentro dela (pega
    todas as folhas de borda, ja que o contorno tem milhares de vertices) ou
    se algum de seus cantos ou o centro cair dentro do Estado (pega as folhas
    inteiramente internas, sem nenhum vertice).
    """
    mantidas = []

    for identificador, oeste_folha, norte_folha in folhas:
        leste_folha = oeste_folha + 1.5
        sul_folha = norte_folha - 1.0

        tem_vertice = any(
            oeste_folha <= x <= leste_folha and sul_folha <= y <= norte_folha
            for poligono in poligonos
            for anel in poligono
            for x, y in anel
        )

        if not tem_vertice:
            amostras = (
                (oeste_folha + 0.75, norte_folha - 0.5),
                (oeste_folha, norte_folha),
                (leste_folha, norte_folha),
                (oeste_folha, sul_folha),
                (leste_folha, sul_folha),
            )
            if not any(_dentro(x, y, poligonos) for x, y in amostras):
                continue

        mantidas.append((identificador, oeste_folha, norte_folha))

    return mantidas


def montar(bbox, res_alvo, cache, poligonos=None, manter_folhas=False):
    """Mosaico equirretangular das altitudes na bbox, em res_alvo graus/pixel.

    Cada folha e reduzida ao chegar e guardada em cache ja reduzida (poucos
    MB). O GeoTIFF original so e mantido com manter_folhas=True.
    """
    oeste, sul, leste, norte = bbox
    fator = max(1, int(round(res_alvo / RES_FOLHA)))
    passo = RES_FOLHA * fator

    largura = int(round((leste - oeste) / passo))
    altura = int(round((norte - sul) / passo))
    mosaico = numpy.full((altura, largura), numpy.nan, dtype=numpy.float32)

    folhas = listar_folhas(bbox)
    if poligonos:
        antes = len(folhas)
        folhas = filtrar_folhas(folhas, poligonos)
        print("  %d folhas na area, %d descartadas fora do Estado"
              % (len(folhas), antes - len(folhas)))

    cache.mkdir(parents=True, exist_ok=True)
    print("  reducao %dx (%.4f graus/px)" % (fator, passo))

    for numero, (identificador, folha_oeste, folha_norte) in enumerate(folhas, 1):
        reduzida = cache / ("%s_%dx.npy" % (identificador, fator))

        if reduzida.exists():
            dados = numpy.load(reduzida, allow_pickle=False)
            if dados.size == 0:
                continue
            origem_oeste, origem_norte = folha_oeste, folha_norte
        else:
            bruta = cache / ("%s.tif" % identificador)
            print("  [%d/%d] %s" % (numero, len(folhas), identificador))

            if not bruta.exists() and not baixar_folha(identificador, bruta):
                cache.mkdir(parents=True, exist_ok=True)
                numpy.save(reduzida, numpy.empty(0, dtype=numpy.float32))
                continue

            matriz, origem_oeste, origem_norte, _, _ = ler_geotiff(bruta)
            # O SRTM marca ausencia de dado com valores muito negativos.
            matriz = numpy.where(matriz < -1000, numpy.nan, matriz)
            dados = reduzir_bloco(matriz, fator).astype(numpy.float32)

            cache.mkdir(parents=True, exist_ok=True)
            numpy.save(reduzida, dados)
            if not manter_folhas:
                bruta.unlink(missing_ok=True)

        # Posicao da folha reduzida dentro do mosaico.
        coluna = int(round((origem_oeste - oeste) / passo))
        linha = int(round((norte - origem_norte) / passo))

        x0, y0 = max(0, coluna), max(0, linha)
        x1 = min(largura, coluna + dados.shape[1])
        y1 = min(altura, linha + dados.shape[0])
        if x0 >= x1 or y0 >= y1:
            continue

        recorte = dados[y0 - linha:y1 - linha, x0 - coluna:x1 - coluna]
        destino = mosaico[y0:y1, x0:x1]
        mosaico[y0:y1, x0:x1] = numpy.where(numpy.isnan(destino), recorte, destino)

    # Zerar o que sobrou e certo para o mar, mas uma folha que falhou no
    # download deixa um retangulo inteiro de NaN que vira um plato de 0 m --
    # e o gerador de curvas desenha a borda dele como se fosse relevo. O
    # aviso e barato e evita depurar isso pelo desenho.
    faltando = int(numpy.isnan(mosaico).sum())
    if faltando:
        print(
            "  aviso: %d celulas sem dado (%.2f%% do mosaico) zeradas"
            % (faltando, 100.0 * faltando / mosaico.size)
        )

    # Oceano e vazios: altitude zero, para nao abrir buracos no sombreamento.
    return numpy.nan_to_num(mosaico, nan=0.0)


def para_grade_mercator(mosaico, bbox, largura, altura, lat_para_px, zoom):
    """Reamostra o mosaico equirretangular na grade do mapa (Web Mercator).

    TOPODATA e equirretangular; o mapa e Mercator, onde o espacamento em
    latitude varia. A reamostragem e por vizinho mais proximo, o que basta
    porque o mosaico ja foi reduzido por media de blocos.
    """
    oeste, sul, leste, norte = bbox
    alt_origem, larg_origem = mosaico.shape

    colunas = numpy.clip(
        ((numpy.arange(largura) + 0.5) / largura * larg_origem).astype(int),
        0,
        larg_origem - 1,
    )

    topo = lat_para_px(norte, zoom)
    base = lat_para_px(sul, zoom)
    y_mercator = topo + (numpy.arange(altura) + 0.5) / altura * (base - topo)
    n = math.pi - 2.0 * math.pi * y_mercator / (256 << zoom)
    latitudes = numpy.degrees(numpy.arctan(numpy.sinh(n)))

    linhas = numpy.clip(
        ((norte - latitudes) / (norte - sul) * alt_origem).astype(int),
        0,
        alt_origem - 1,
    )

    return mosaico[numpy.ix_(linhas, colunas)]
