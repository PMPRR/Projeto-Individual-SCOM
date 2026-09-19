#!/usr/bin/env python3
"""Gera os dados estaticos do mapa do ClimaSP.

Produz dois arquivos:
    assets/data/sp-geo.js    malha do Estado de Sao Paulo (IBGE)
    assets/img/relevo-sp.png sombreamento do relevo (tiles Terrarium)

Uso:
    python3 tools/build-sp-geo.py              ambos
    python3 tools/build-sp-geo.py --geo        apenas a malha
    python3 tools/build-sp-geo.py --relevo     apenas o relevo

O relevo vem do MDE TOPODATA (INPE). A opcao --terrain-tiles troca a fonte
pelos tiles Terrarium da AWS, mais leves de baixar e menos oficiais.

Sem dependencias externas: apenas a biblioteca padrao. O PNG e lido e escrito
com zlib, e o sombreamento e calculado aqui mesmo, para nao exigir que quem
clonar o repositorio instale GDAL, numpy ou Pillow.

Por que um .js e nao um .geojson: a pagina precisa abrir por file:// e o
fetch() do navegador e bloqueado pela politica de mesma origem nesse
protocolo. O arquivo gerado define window.SP_GEOJSON e e carregado por uma
tag <script>, que nao sofre essa restricao. O PNG e uma imagem comum, logo
nao sofre a mesma restricao e fica em assets/img/.
"""

import gzip
import json
import math
import struct
import sys
import urllib.error
import urllib.request
import zlib
from pathlib import Path

try:
    import numpy
except ImportError:  # so o passo do relevo depende disso
    numpy = None

UF = "SP"
COD_UF = "35"  # codigo do IBGE para o Estado de Sao Paulo

# Fontes primarias: API de malhas territoriais do IBGE, tentadas em ordem.
# Sao varias porque a API mudou entre as versoes 2 e 3 e nem todo parametro
# vale nas duas. Detalhe que costuma passar despercebido: o sinal de mais em
# "vnd.geo+json" precisa ir como %2B, senao parte dos servidores o interpreta
# como espaco e responde 400.
# As coordenadas vem em SIRGAS 2000 (EPSG:4674), que nesta escala e
# indistinguivel do WGS 84 usado pelo Leaflet.
FONTES_IBGE = (
    "https://servicodados.ibge.gov.br/api/v3/malhas/estados/" + COD_UF +
    "?formato=application/vnd.geo%2Bjson&qualidade=4",
    "https://servicodados.ibge.gov.br/api/v3/malhas/estados/" + COD_UF +
    "?formato=application/vnd.geo%2Bjson",
    "https://servicodados.ibge.gov.br/api/v3/malhas/estados/" + UF +
    "?formato=application/vnd.geo%2Bjson",
    "https://servicodados.ibge.gov.br/api/v2/malhas/" + COD_UF +
    "?formato=application/vnd.geo%2Bjson&resolucao=0&qualidade=4",
)

# Reserva: espelho da mesma malha do IBGE em repositorio publico, usado caso
# o servico do IBGE esteja fora do ar.
FONTE_ESPELHO = (
    "https://raw.githubusercontent.com/giuliano-macedo/"
    "geodata-br-states/main/geojson/br_states.json"
)

# Caminho resolvido a partir deste arquivo, e nao do diretorio de trabalho:
# o script funciona chamado de qualquer lugar.
RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "assets" / "data" / "sp-geo.js"
SAIDA_RELEVO = RAIZ / "assets" / "img" / "relevo-sp.png"

# --- Relevo -----------------------------------------------------------------

# Tiles Terrarium: PNG onde cada pixel guarda a altitude codificada nos canais
# de cor. Servico publico da AWS (conjunto Terrain Tiles), sem chave de acesso.
# Dados de origem: SRTM e outras fontes abertas de altimetria.
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# Zoom 9 da cerca de 300 m por pixel nesta latitude. O mosaico e calculado
# nessa resolucao e reduzido por SUPERAMOSTRAGEM na hora de gravar: calcular
# grande e reduzir suaviza o ruido do sombreamento e, principalmente, produz
# bordas com antialiasing no recorte do litoral.
ZOOM_RELEVO = 9
SUPERAMOSTRAGEM = 3

# Extensao da imagem gerada. Precisa ser identica a RELEVO_LIMITES em map.js,
# senao o raster nao coincide com a malha. Ordem: oeste, sul, leste, norte.
BBOX_RELEVO = (-53.12, -25.32, -44.15, -19.77)

# Sombreamento multidirecional: em vez de uma unica fonte de luz, combina
# quatro azimutes com pesos diferentes. Uma luz so deixa toda encosta voltada
# para sudeste chapada de preto; varias preservam detalhe nos dois lados da
# Serra do Mar. Convencao cartografica: a luz principal vem do noroeste.
AZIMUTES = ((315.0, 0.40), (270.0, 0.25), (360.0, 0.20), (225.0, 0.15))
ALTITUDE_SOL = 45.0

# Exagero vertical aplicado a declividade.
EXAGERO = 2.0

# Compressao nao linear da declividade. No Estado convivem a escarpa da Serra
# do Mar (cerca de 800 m em 4 km) e a ondulacao do planalto (dezenas de metros
# em varios quilometros) -- duas ordens de grandeza. Com resposta linear, ou a
# escarpa satura em preto ou o planalto some; elevar o gradiente a 0,6
# aproxima os dois extremos antes do calculo da luz.
GAMA = 0.6

# Contraste final em torno do cinza medio, aplicado por tangente hiperbolica:
# satura suavemente em vez de cortar, preservando detalhe nas encostas fortes.
GANHO = 4.0

# Niveis da escala de cinza no PNG final. Menos niveis, arquivo menor.
NIVEIS_CINZA = 16

# Cache dos tiles baixados: o zoom 9 exige ~140 tiles, e repetir o download a
# cada execucao e desnecessario. Acrescente tools/.cache/ ao .gitignore.
CACHE = Path(__file__).resolve().parent / ".cache" / "terrarium"

# Tolerancia do Douglas-Peucker em graus. 0,001 grau e cerca de 110 m: menos
# de um pixel no zoom maximo util do mapa (nivel 10, ~150 m/px nesta latitude).
EPS = 0.001

# Area minima de um poligono para permanecer no arquivo (graus quadrados).
# Neste patamar entram Ilhabela, Sao Sebastiao, Cardoso e Comprida; ficam de
# fora apenas lajes e ilhotas menores que um punhado de pixels.
MIN_AREA = 0.00002

# Casas decimais das coordenadas. 5 casas equivalem a cerca de 1 m, abaixo da
# tolerancia da simplificacao, logo nao e o arredondamento que limita a forma.
PRECISAO = 5


def douglas_peucker(pontos, eps):
    """Reduz a poligonal mantendo os vertices que definem sua forma."""
    if len(pontos) < 3:
        return pontos

    manter = [False] * len(pontos)
    manter[0] = manter[-1] = True
    pilha = [(0, len(pontos) - 1)]

    while pilha:
        i, j = pilha.pop()
        ax, ay = pontos[i]
        bx, by = pontos[j]
        dx, dy = bx - ax, by - ay
        norma = (dx * dx + dy * dy) ** 0.5

        maior, indice = 0.0, -1
        for k in range(i + 1, j):
            px, py = pontos[k]
            if norma == 0:
                dist = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                dist = abs(dy * px - dx * py + bx * ay - by * ax) / norma
            if dist > maior:
                maior, indice = dist, k

        if maior > eps and indice != -1:
            manter[indice] = True
            pilha.append((i, indice))
            pilha.append((indice, j))

    return [p for p, k in zip(pontos, manter) if k]


def area(anel):
    """Area do poligono pela formula do cadarco (shoelace)."""
    soma = 0.0
    for i in range(len(anel) - 1):
        soma += anel[i][0] * anel[i + 1][1] - anel[i + 1][0] * anel[i][1]
    return abs(soma) / 2


def baixar(url):
    """Baixa e decodifica um GeoJSON.

    User-Agent explicito porque servicos publicos costumam recusar o cabecalho
    padrao do urllib. A resposta pode vir comprimida: o urllib anuncia gzip
    mas nao descomprime sozinho, e o IBGE responde comprimido mesmo sem o
    pedido explicito, o que aparece como um byte 0x8b invalido no UTF-8.
    """
    pedido = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ClimaSP/1.0 (trabalho academico)",
            "Accept-Encoding": "gzip, deflate",
        },
    )

    with urllib.request.urlopen(pedido, timeout=120) as resposta:
        bruto = resposta.read()
        codificacao = (resposta.headers.get("Content-Encoding") or "").lower()

    if codificacao == "gzip" or bruto[:2] == b"\x1f\x8b":
        bruto = gzip.decompress(bruto)
    elif codificacao == "deflate":
        bruto = zlib.decompress(bruto, -zlib.MAX_WBITS)

    return json.loads(bruto.decode("utf-8"))


def obter_geometria():
    """Devolve (geometria do Estado, nome da fonte usada)."""
    for tentativa, url in enumerate(FONTES_IBGE, 1):
        try:
            print("Baixando do IBGE (tentativa %d)..." % tentativa)
            colecao = baixar(url)
            # A API devolve uma FeatureCollection com uma unica feicao.
            geometria = colecao["features"][0]["geometry"]
            return geometria, "API de malhas do IBGE"
        except (urllib.error.URLError, KeyError, IndexError, ValueError) as erro:
            print("  falhou (%s)" % erro)

    print("  nenhuma variante do IBGE respondeu; usando o espelho.")
    colecao = baixar(FONTE_ESPELHO)
    estado = next(
        f for f in colecao["features"] if f["properties"]["SIGLA"] == UF
    )
    return estado["geometry"], "espelho geodata-br-states"


def normalizar(geometria):
    """Trata Polygon e MultiPolygon da mesma forma: lista de poligonos."""
    if geometria["type"] == "Polygon":
        return [geometria["coordinates"]]
    return geometria["coordinates"]


def construir_malha(escrever=True):
    """Devolve os poligonos simplificados do Estado e, se escrever for
    verdadeiro, grava sp-geo.js. O recorte do relevo usa os mesmos poligonos,
    por isso eles sao sempre calculados."""
    geometria, fonte = obter_geometria()
    entrada = normalizar(geometria)

    originais = sum(len(anel) for poligono in entrada for anel in poligono)

    poligonos = []
    for poligono in entrada:
        if area(poligono[0]) < MIN_AREA:
            continue

        aneis = []
        for anel in poligono:
            if area(anel) < MIN_AREA:
                continue
            simplificado = douglas_peucker([tuple(p) for p in anel], EPS)
            if len(simplificado) < 4:
                continue
            if simplificado[0] != simplificado[-1]:
                simplificado.append(simplificado[0])
            aneis.append(
                [[round(x, PRECISAO), round(y, PRECISAO)] for x, y in simplificado]
            )

        if aneis:
            poligonos.append(aneis)

    # Maior poligono primeiro: o continente antes das ilhas.
    poligonos.sort(key=lambda p: -area([tuple(q) for q in p[0]]))

    resultado = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"sigla": UF, "nome": "São Paulo"},
                "geometry": {"type": "MultiPolygon", "coordinates": poligonos},
            }
        ],
    }

    corpo = json.dumps(resultado, ensure_ascii=False, separators=(",", ":"))
    cabecalho = (
        "/* Gerado por tools/build-sp-geo.py. Nao editar a mao.\n"
        "   Fonte: malha estadual do IBGE (%s).\n"
        "   Simplificacao: Douglas-Peucker, tolerancia %s grau. */\n\n"
        "window.SP_GEOJSON = " % (fonte, EPS)
    )

    if not escrever:
        return poligonos

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(cabecalho + corpo + ";\n", encoding="utf-8")

    finais = sum(len(anel) for p in poligonos for anel in p)
    print(
        "%s: %d poligonos, %d pontos (de %d), %.1f kB"
        % (
            SAIDA.relative_to(RAIZ),
            len(poligonos),
            finais,
            originais,
            len(corpo) / 1024,
        )
    )

    return poligonos


# ============================================================================
# Relevo: mosaico de tiles -> sombreamento -> recorte pelo contorno do Estado
# ============================================================================


def lon_para_px(lon, zoom):
    """Longitude -> coordenada global de pixel (Web Mercator)."""
    return (lon + 180.0) / 360.0 * (256 << zoom)


def lat_para_px(lat, zoom):
    """Latitude -> coordenada global de pixel (Web Mercator)."""
    rad = math.radians(lat)
    y = (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0
    return y * (256 << zoom)


def ler_png(dados):
    """Decodifica um PNG de 8 bits sem entrelacamento.

    Devolve (largura, altura, canais, pixels). Nao usa Pillow: basta juntar os
    blocos IDAT, descomprimir e desfazer os filtros linha a linha.
    """
    if dados[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("nao e um arquivo PNG")

    pos = 8
    largura = altura = canais = None
    idat = bytearray()

    while pos < len(dados):
        tamanho = struct.unpack(">I", dados[pos:pos + 4])[0]
        tipo = dados[pos + 4:pos + 8]
        corpo = dados[pos + 8:pos + 8 + tamanho]
        pos += 12 + tamanho  # 4 tamanho + 4 tipo + corpo + 4 CRC

        if tipo == b"IHDR":
            largura, altura, prof, cor = struct.unpack(">IIBB", corpo[:10])
            if prof != 8 or corpo[12] != 0:
                raise ValueError("PNG deve ter 8 bits por canal e sem entrelacamento")
            canais = {0: 1, 2: 3, 4: 2, 6: 4}.get(cor)
            if canais is None:
                raise ValueError("tipo de cor %d nao suportado" % cor)
        elif tipo == b"IDAT":
            idat += corpo
        elif tipo == b"IEND":
            break

    bruto = zlib.decompress(bytes(idat))
    passo = largura * canais
    saida = bytearray(altura * passo)
    anterior = bytearray(passo)
    origem = 0

    for linha in range(altura):
        filtro = bruto[origem]
        origem += 1
        atual = bytearray(bruto[origem:origem + passo])
        origem += passo

        if filtro == 1:  # Sub
            for i in range(canais, passo):
                atual[i] = (atual[i] + atual[i - canais]) & 0xFF
        elif filtro == 2:  # Up
            for i in range(passo):
                atual[i] = (atual[i] + anterior[i]) & 0xFF
        elif filtro == 3:  # Average
            for i in range(passo):
                esq = atual[i - canais] if i >= canais else 0
                atual[i] = (atual[i] + ((esq + anterior[i]) >> 1)) & 0xFF
        elif filtro == 4:  # Paeth
            for i in range(passo):
                a = atual[i - canais] if i >= canais else 0
                b = anterior[i]
                c = anterior[i - canais] if i >= canais else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                atual[i] = (atual[i] + pr) & 0xFF
        elif filtro != 0:
            raise ValueError("filtro PNG desconhecido: %d" % filtro)

        saida[linha * passo:(linha + 1) * passo] = atual
        anterior = atual

    return largura, altura, canais, saida


def _filtrar_linha(atual, anterior):
    """Escolhe o filtro PNG da linha pela heuristica da soma minima.

    Sao 5 filtros possiveis (nenhum, Sub, Up, Average, Paeth). Como o
    sombreamento e quase todo gradiente suave, filtrar antes de comprimir
    reduz bastante o arquivo -- gravar tudo com filtro "nenhum" desperdica
    a maior parte do ganho do zlib.
    """
    canais = 2  # cinza + alfa
    candidatos = []

    nenhum = bytes(atual)
    candidatos.append((0, nenhum))

    sub = bytearray(len(atual))
    for i in range(len(atual)):
        esq = atual[i - canais] if i >= canais else 0
        sub[i] = (atual[i] - esq) & 0xFF
    candidatos.append((1, bytes(sub)))

    cima = bytearray(len(atual))
    for i in range(len(atual)):
        cima[i] = (atual[i] - anterior[i]) & 0xFF
    candidatos.append((2, bytes(cima)))

    paeth = bytearray(len(atual))
    for i in range(len(atual)):
        a = atual[i - canais] if i >= canais else 0
        b = anterior[i]
        c = anterior[i - canais] if i >= canais else 0
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
        paeth[i] = (atual[i] - pr) & 0xFF
    candidatos.append((4, bytes(paeth)))

    def custo(dados):
        return sum(b if b < 128 else 256 - b for b in dados)

    return min(candidatos, key=lambda par: custo(par[1]))


def escrever_png(caminho, largura, altura, cinza, alfa):
    """Grava um PNG de 8 bits em tons de cinza com canal alfa (tipo de cor 4)."""
    linhas = bytearray()
    anterior = bytes(largura * 2)

    for y in range(altura):
        base = y * largura
        atual = bytearray(largura * 2)
        for x in range(largura):
            atual[2 * x] = cinza[base + x]
            atual[2 * x + 1] = alfa[base + x]

        tipo, filtrada = _filtrar_linha(atual, anterior)
        linhas.append(tipo)
        linhas.extend(filtrada)
        anterior = bytes(atual)

    def bloco(tipo, corpo):
        return (
            struct.pack(">I", len(corpo))
            + tipo
            + corpo
            + struct.pack(">I", zlib.crc32(tipo + corpo) & 0xFFFFFFFF)
        )

    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "wb") as arquivo:
        arquivo.write(b"\x89PNG\r\n\x1a\n")
        arquivo.write(bloco(b"IHDR", struct.pack(">IIBBBBB", largura, altura, 8, 4, 0, 0, 0)))
        arquivo.write(bloco(b"IDAT", zlib.compress(bytes(linhas), 9)))
        arquivo.write(bloco(b"IEND", b""))


def caminho_cache(zoom, x, y):
    return CACHE / str(zoom) / str(x) / ("%d.png" % y)


def baixar_tile(zoom, x, y):
    """Devolve os bytes de um tile Terrarium, do cache quando possivel.

    None significa tile inexistente (fora da cobertura), tratado como altitude
    zero -- o caso do oceano no canto sudeste da area.
    """
    destino = caminho_cache(zoom, x, y)
    if destino.exists():
        return destino.read_bytes() or None

    url = TILE_URL.format(z=zoom, x=x, y=y)
    pedido = urllib.request.Request(
        url, headers={"User-Agent": "ClimaSP/1.0 (trabalho academico)"}
    )
    try:
        with urllib.request.urlopen(pedido, timeout=60) as resposta:
            dados = resposta.read()
    except urllib.error.HTTPError as erro:
        if erro.code == 404:
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(b"")  # marca o vazio para nao repetir o pedido
            return None
        raise

    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(dados)
    return dados


def decodificar(dados):
    """(largura, altura, matriz RGB). Usa Pillow quando existir, porque o
    decodificador proprio, em Python puro, custa alguns segundos por tile."""
    try:
        from PIL import Image
        import io

        imagem = Image.open(io.BytesIO(dados)).convert("RGB")
        return imagem.width, imagem.height, numpy.asarray(imagem)
    except ImportError:
        largura, altura, canais, pixels = ler_png(dados)
        matriz = numpy.frombuffer(bytes(pixels), dtype=numpy.uint8)
        matriz = matriz.reshape(altura, largura, canais)[:, :, :3]
        return largura, altura, matriz


def grade_alvo(zoom, bbox):
    """Dimensoes em pixels da grade de trabalho, em Web Mercator."""
    oeste, sul, leste, norte = bbox
    largura = int(round(lon_para_px(leste, zoom) - lon_para_px(oeste, zoom)))
    altura = int(round(lat_para_px(sul, zoom) - lat_para_px(norte, zoom)))
    return largura, altura


def montar_altitudes(zoom, bbox):
    """Mosaico de altitudes em metros cobrindo a bbox.

    Terrarium codifica a altitude como h = (R*256 + G + B/256) - 32768.
    """
    oeste, sul, leste, norte = bbox

    px_esq = lon_para_px(oeste, zoom)
    px_dir = lon_para_px(leste, zoom)
    px_topo = lat_para_px(norte, zoom)
    px_base = lat_para_px(sul, zoom)

    largura = int(round(px_dir - px_esq))
    altura = int(round(px_base - px_topo))
    esq, topo = int(px_esq), int(px_topo)

    tx0, tx1 = esq // 256, int(px_dir) // 256
    ty0, ty1 = topo // 256, int(px_base) // 256
    total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)

    altitudes = numpy.zeros((altura, largura), dtype=numpy.float32)
    feitos = 0

    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            feitos += 1
            if feitos % 10 == 0 or feitos == total:
                print("  %d/%d tiles" % (feitos, total))

            dados = baixar_tile(zoom, tx, ty)
            if dados is None:
                continue

            larg_t, alt_t, rgb = decodificar(dados)
            valores = (
                rgb[:, :, 0].astype(numpy.float32) * 256.0
                + rgb[:, :, 1].astype(numpy.float32)
                + rgb[:, :, 2].astype(numpy.float32) / 256.0
                - 32768.0
            )

            # Interseccao entre o tile e a area de interesse.
            dx, dy = tx * 256 - esq, ty * 256 - topo
            x0, y0 = max(0, dx), max(0, dy)
            x1, y1 = min(largura, dx + larg_t), min(altura, dy + alt_t)
            if x0 >= x1 or y0 >= y1:
                continue

            altitudes[y0:y1, x0:x1] = valores[y0 - dy:y1 - dy, x0 - dx:x1 - dx]

    return altitudes


def sombrear(altitudes, bbox):
    """Sombreamento multidirecional pelo metodo de Horn (o do gdaldem)."""
    altura, largura = altitudes.shape
    oeste, sul, leste, norte = bbox
    lat_media = (sul + norte) / 2.0

    # Tamanho do pixel em metros; a aproximacao por graus basta nesta escala.
    dx = (leste - oeste) / largura * 111320.0 * math.cos(math.radians(lat_media))
    dy = (norte - sul) / altura * 110540.0

    # Vizinhanca 3x3 por deslocamento das bordas (equivale a repetir a borda).
    c = altitudes
    n = numpy.vstack([c[:1], c[:-1]])
    s_ = numpy.vstack([c[1:], c[-1:]])

    def esq(m):
        return numpy.hstack([m[:, :1], m[:, :-1]])

    def dir_(m):
        return numpy.hstack([m[:, 1:], m[:, -1:]])

    a, b, cc = esq(n), n, dir_(n)
    d, f = esq(c), dir_(c)
    g, h, i = esq(s_), s_, dir_(s_)

    dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * dx)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + cc)) / (8 * dy)

    gradiente = numpy.hypot(dzdx, dzdy)
    declive = numpy.arctan(EXAGERO * numpy.power(gradiente, GAMA))
    orientacao = numpy.arctan2(dzdy, -dzdx)

    zenite = math.radians(90.0 - ALTITUDE_SOL)
    cos_z, sin_z = math.cos(zenite), math.sin(zenite)
    cos_decl, sin_decl = numpy.cos(declive), numpy.sin(declive)

    acumulado = numpy.zeros_like(altitudes)
    for graus, peso in AZIMUTES:
        azimute = math.radians(360.0 - graus + 90.0)
        luz = cos_z * cos_decl + sin_z * sin_decl * numpy.cos(azimute - orientacao)
        acumulado += peso * numpy.clip(luz, 0.0, 1.0)

    acumulado /= sum(peso for _, peso in AZIMUTES)
    return acumulado


def recortar(largura, altura, poligonos, bbox):
    """Mascara do Estado: 1 dentro, 0 fora, por varredura par-impar."""
    oeste, sul, leste, norte = bbox
    mascara = numpy.zeros((altura, largura), dtype=numpy.float32)

    topo = lat_para_px(norte, ZOOM_RELEVO)
    escala_x = largura / (leste - oeste)

    arestas = []
    for poligono in poligonos:
        for anel in poligono:
            for k in range(len(anel) - 1):
                (lon1, lat1), (lon2, lat2) = anel[k], anel[k + 1]
                y1 = lat_para_px(lat1, ZOOM_RELEVO) - topo
                y2 = lat_para_px(lat2, ZOOM_RELEVO) - topo
                if y1 != y2:
                    arestas.append(
                        ((lon1 - oeste) * escala_x, y1, (lon2 - oeste) * escala_x, y2)
                    )

    for y in range(altura):
        centro = y + 0.5
        cruzamentos = sorted(
            x1 + (centro - y1) / (y2 - y1) * (x2 - x1)
            for x1, y1, x2, y2 in arestas
            if (y1 <= centro < y2) or (y2 <= centro < y1)
        )
        for k in range(0, len(cruzamentos) - 1, 2):
            inicio = max(0, int(math.ceil(cruzamentos[k] - 0.5)))
            fim = min(largura, int(math.floor(cruzamentos[k + 1] - 0.5)) + 1)
            if fim > inicio:
                mascara[y, inicio:fim] = 1.0

    return mascara


def reduzir(matriz, fator):
    """Media de blocos fator x fator. E o que suaviza o ruido do sombreamento
    e cria a transicao gradual na borda da mascara (antialiasing)."""
    altura = matriz.shape[0] // fator * fator
    largura = matriz.shape[1] // fator * fator
    cortada = matriz[:altura, :largura]
    return cortada.reshape(
        altura // fator, fator, largura // fator, fator
    ).mean(axis=(1, 3))


def construir_relevo(poligonos, fonte="topodata"):
    if numpy is None:
        raise SystemExit(
            "A geracao do relevo precisa do numpy: pip install numpy\n"
            "(a malha do Estado, com --geo, continua sem dependencias)"
        )

    if fonte == "topodata":
        import fonte_topodata

        print("Baixando altitudes do TOPODATA/INPE...")
        largura, altura = grade_alvo(ZOOM_RELEVO, BBOX_RELEVO)
        resolucao = (BBOX_RELEVO[2] - BBOX_RELEVO[0]) / largura
        mosaico = fonte_topodata.montar(
            BBOX_RELEVO,
            resolucao,
            CACHE / "topodata",
            poligonos=poligonos,
        )
        altitudes = fonte_topodata.para_grade_mercator(
            mosaico, BBOX_RELEVO, largura, altura, lat_para_px, ZOOM_RELEVO
        )
        credito = "MDE TOPODATA (INPE), SRTM refinado por krigagem"
    else:
        print("Baixando altitudes (Terrain Tiles, zoom %d)..." % ZOOM_RELEVO)
        altitudes = montar_altitudes(ZOOM_RELEVO, BBOX_RELEVO)
        altura, largura = altitudes.shape
        credito = "Terrain Tiles (SRTM)"

    print("Sombreando %d x %d px, %d direcoes de luz..." % (largura, altura, len(AZIMUTES)))
    luz = sombrear(altitudes, BBOX_RELEVO)

    print("Recortando pelo contorno do Estado...")
    mascara = recortar(largura, altura, poligonos, BBOX_RELEVO)

    luz = reduzir(luz, SUPERAMOSTRAGEM)
    mascara = reduzir(mascara, SUPERAMOSTRAGEM)

    # Terreno plano devolve sempre cos(zenite); sem tratamento, o Estado
    # inteiro sai quase branco e as encostas somem. Aqui o plano vira cinza
    # medio e o contraste se distribui em torno dele: so o relevo aparece.
    plano = math.cos(math.radians(90.0 - ALTITUDE_SOL))
    luz = 0.5 + 0.5 * numpy.tanh((luz - plano) * GANHO)

    # Quantiza a escala de cinza. O relevo e um fundo discreto: com 32 niveis
    # a diferenca e imperceptivel sobre a pagina, e o PNG encolhe bastante
    # porque areas vizinhas passam a repetir o mesmo valor.
    passos = 255.0 / (NIVEIS_CINZA - 1)
    cinza = (numpy.round(luz * 255 / passos) * passos).astype(numpy.uint8).tobytes()
    alfa = (mascara * 255).astype(numpy.uint8).tobytes()
    altura_final, largura_final = mascara.shape

    escrever_png(SAIDA_RELEVO, largura_final, altura_final, cinza, alfa)
    print("  fonte: %s" % credito)
    print(
        "%s: %d x %d px, %.0f m/px, %.0f kB"
        % (
            SAIDA_RELEVO.relative_to(RAIZ),
            largura_final,
            altura_final,
            (BBOX_RELEVO[2] - BBOX_RELEVO[0]) / largura_final * 111320 * 0.92,
            SAIDA_RELEVO.stat().st_size / 1024,
        )
    )


def main():
    argumentos = set(sys.argv[1:])
    desconhecidos = argumentos - {"--geo", "--relevo", "--topodata", "--terrain-tiles"}
    if desconhecidos:
        print("argumento desconhecido: %s" % ", ".join(sorted(desconhecidos)))
        print(__doc__)
        return 1

    fonte = "terrarium" if "--terrain-tiles" in argumentos else "topodata"
    pedidos = argumentos - {"--topodata", "--terrain-tiles"}

    quer_geo = not pedidos or "--geo" in pedidos
    quer_relevo = not pedidos or "--relevo" in pedidos

    poligonos = construir_malha(escrever=quer_geo)

    if quer_relevo:
        if quer_geo:
            print()
        construir_relevo(poligonos, fonte)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
