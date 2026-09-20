#!/usr/bin/env python3
"""Gera a malha municipal do Estado de Sao Paulo para o ClimaSP.

Produz um arquivo:
    assets/data/sp-municipios.js    divisas dos 645 municipios (IBGE)

Uso:
    python3 tools/build-municipios.py
    python3 tools/build-municipios.py --qualidade 4    malha mais detalhada

Sem dependencias externas: apenas a biblioteca padrao.

Por que um .js e nao um .geojson: a pagina precisa abrir por file://, e o
fetch() do navegador e bloqueado pela politica de mesma origem nesse
protocolo. O arquivo gerado define window.SP_MUNICIPIOS e e carregado por uma
tag <script>, que nao sofre essa restricao. E a mesma razao de sp-geo.js.

Por que um script separado de build-sp-geo.py: aquele monta a base do mapa (a
malha do Estado e o relevo), sem a qual a pagina nao abre. Este monta uma
camada opcional, e o mapa continua funcionando sem ela -- map.js desabilita a
caixa de selecao e explica o motivo. Separados, quem so quer a base nao paga
por um download de alguns megabytes.

As coordenadas vem em SIRGAS 2000 (EPSG:4674), que nesta escala e
indistinguivel do WGS 84 usado pelo Leaflet.
"""

import argparse
import gzip
import json
import sys
import urllib.error
import urllib.request
import zlib
from pathlib import Path

COD_UF = "35"  # codigo do IBGE para o Estado de Sao Paulo

# API de malhas territoriais do IBGE. O parametro que divide o Estado em
# municipios, em vez de devolver um poligono so, e o intrarregiao=municipio --
# ou, na forma antiga, resolucao=5.
#
# Varias URLs tentadas em ordem, como em build-sp-geo.py, porque a API mudou
# entre as versoes e nem todo parametro vale nas duas. Em particular o
# parametro qualidade aparece documentado de duas maneiras incompativeis: como
# numero de 1 a 4 e como palavra (minima, intermediaria, maxima). Qual das
# duas o servidor aceita hoje nao da para saber sem perguntar, entao as duas
# entram na lista, seguidas da variante sem qualidade nenhuma -- que e a forma
# mais citada por quem usa esta rota e provavelmente a que funciona.
#
# Detalhe que costuma passar despercebido: o sinal de mais em "vnd.geo+json"
# precisa ir como %2B, senao parte dos servidores o interpreta como espaco e
# responde 400. Mesmo tropeco documentado em build-sp-geo.py.
FORMATO = "formato=application/vnd.geo%2Bjson"
V3 = "https://servicodados.ibge.gov.br/api/v3/malhas/estados/"
V2 = "https://servicodados.ibge.gov.br/api/v2/malhas/"

PALAVRA = {1: "minima", 2: "minima", 3: "intermediaria", 4: "maxima"}


def candidatos(qualidade):
    numero = str(qualidade)
    palavra = PALAVRA[qualidade]
    return (
        V3 + COD_UF + "?" + FORMATO + "&intrarregiao=municipio&qualidade=" + numero,
        V3 + COD_UF + "?" + FORMATO + "&intrarregiao=municipio&qualidade=" + palavra,
        V3 + COD_UF + "?" + FORMATO + "&intrarregiao=municipio",
        V3 + "SP?" + FORMATO + "&intrarregiao=municipio",
        V3 + COD_UF + "?" + FORMATO + "&resolucao=5&qualidade=" + numero,
        V3 + COD_UF + "?" + FORMATO + "&resolucao=5",
        V2 + COD_UF + "?" + FORMATO + "&resolucao=5&qualidade=" + numero,
        V2 + COD_UF + "?" + FORMATO + "&resolucao=5",
    )


# Abaixo disto a resposta nao e a malha municipal: pode ser o contorno do
# Estado (1 feicao) ou uma divisao mais grossa, que a API devolve com 200
# quando ignora um parametro em vez de recusa-lo. Sao Paulo tem 645
# municipios; o piso e folgado so para nao depender do numero exato.
MINIMO_DE_FEICOES = 100

# Nomes dos municipios: a malha traz o codigo, nao o nome.
NOMES = (
    "https://servicodados.ibge.gov.br/api/v1/localidades/estados/" + COD_UF +
    "/municipios"
)

# Tolerancia do Douglas-Peucker em graus. 0,0015 grau e cerca de 165 m: pouco
# mais de um pixel no zoom maximo util do mapa (nivel 12 nesta latitude), e o
# suficiente para a malha inteira caber em algumas centenas de kilobytes.
EPS = 0.0015

# Area minima de um poligono para permanecer no arquivo (graus quadrados).
# Corta ilhotas e slivers de fronteira sem remover nenhum municipio: o menor
# do Estado, Aguas de Sao Pedro, tem cerca de 3,6 km2 -- duas ordens de
# grandeza acima deste patamar.
MIN_AREA = 0.000002

# Casas decimais das coordenadas. 4 casas equivalem a cerca de 11 m, abaixo da
# tolerancia da simplificacao, logo nao e o arredondamento que limita a forma.
PRECISAO = 4

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "assets" / "data" / "sp-municipios.js"


def baixar(url):
    """Baixa e decodifica um JSON.

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

    with urllib.request.urlopen(pedido, timeout=180) as resposta:
        bruto = resposta.read()
        codificacao = (resposta.headers.get("Content-Encoding") or "").lower()

    if codificacao == "gzip" or bruto[:2] == b"\x1f\x8b":
        bruto = gzip.decompress(bruto)
    elif codificacao == "deflate":
        bruto = zlib.decompress(bruto, -zlib.MAX_WBITS)

    return json.loads(bruto.decode("utf-8"))


def motivo(erro):
    """Mensagem legivel para uma falha de rede.

    Num HTTPError o corpo da resposta ainda esta no proprio objeto de excecao,
    e e la que o IBGE diz qual parametro recusou. Sem ler esse corpo, resta um
    "400 Bad Request" que nao aponta nada.
    """
    if isinstance(erro, urllib.error.HTTPError):
        corpo = ""
        try:
            bruto = erro.read()
            if bruto[:2] == b"\x1f\x8b":
                bruto = gzip.decompress(bruto)
            corpo = " ".join(bruto.decode("utf-8", "replace").split())[:300]
        except Exception:  # o corpo e diagnostico, nao pode derrubar o script
            pass
        return "HTTP %s %s%s" % (erro.code, erro.reason, " -- " + corpo if corpo else "")
    return str(erro)


def obter_malha(qualidade):
    """Primeira URL que devolver a malha municipal. Devolve (dados, url)."""
    urls = candidatos(qualidade)

    for k, url in enumerate(urls, 1):
        print("  [%d/%d] %s" % (k, len(urls), url))
        try:
            dados = baixar(url)
        except (urllib.error.HTTPError, urllib.error.URLError, ValueError) as erro:
            print("        %s" % motivo(erro))
            continue

        feicoes = dados.get("features") or []
        if len(feicoes) < MINIMO_DE_FEICOES:
            # 200 com a malha errada: a API ignorou o parametro em vez de
            # recusa-lo, e veio o contorno do Estado.
            print("        resposta com %d feicoes, nao e a malha municipal"
                  % len(feicoes))
            continue

        print("        %d feicoes." % len(feicoes))
        return dados, url

    return None, None


def douglas_peucker(pontos, eps):
    """Reduz a poligonal mantendo os vertices que definem sua forma.

    Iterativo, e nao recursivo: alguns contornos do litoral chegam a milhares
    de pontos e estourariam a pilha do interpretador.
    """
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


def arredondar(anel):
    return [[round(x, PRECISAO), round(y, PRECISAO)] for x, y in anel]


def simplificar(geometria):
    """Simplifica todos os aneis e descarta os poligonos residuais.

    Devolve (geometria, bbox) ou (None, None) se nada sobrou.
    """
    if not geometria:
        return None, None

    tipo = geometria.get("type")
    poligonos = (
        [geometria["coordinates"]] if tipo == "Polygon"
        else geometria.get("coordinates", [])
    )

    saida = []
    oeste = sul = float("inf")
    leste = norte = float("-inf")

    for aneis in poligonos:
        limpos = []
        for k, anel in enumerate(aneis):
            pontos = [(p[0], p[1]) for p in anel]
            if pontos[0] != pontos[-1]:
                pontos.append(pontos[0])

            reduzido = douglas_peucker(pontos, EPS)
            if len(reduzido) < 4:
                continue
            if reduzido[0] != reduzido[-1]:
                reduzido.append(reduzido[0])

            # O anel 0 e o contorno externo; os demais sao furos. Se o externo
            # nao sobrevive, o poligono inteiro vai junto.
            if k == 0 and area(reduzido) < MIN_AREA:
                limpos = []
                break
            if k > 0 and area(reduzido) < MIN_AREA:
                continue

            limpos.append(arredondar(reduzido))

        if not limpos:
            continue

        for x, y in limpos[0]:
            oeste = min(oeste, x)
            leste = max(leste, x)
            sul = min(sul, y)
            norte = max(norte, y)

        saida.append(limpos)

    if not saida:
        return None, None

    bbox = [round(v, PRECISAO) for v in (oeste, sul, leste, norte)]

    if len(saida) == 1:
        return {"type": "Polygon", "coordinates": saida[0]}, bbox
    return {"type": "MultiPolygon", "coordinates": saida}, bbox


# Latitudes testadas na varredura do ponto interno. 32 linhas bastam: o
# objetivo e cair dentro do territorio com folga, nao achar o ponto otimo.
VARREDURA = 32


def _cruzamentos(aneis, lat):
    """Abscissas onde a latitude corta os aneis, em ordem.

    Regra semiaberta (um extremo conta, o outro nao) para nao contar vertices
    duas vezes. Furos entram na mesma lista: a paridade os trata sozinha.
    """
    xs = []
    for anel in aneis:
        for i in range(len(anel) - 1):
            x0, y0 = anel[i]
            x1, y1 = anel[i + 1]
            if (y0 <= lat < y1) or (y1 <= lat < y0):
                xs.append(x0 + (lat - y0) * (x1 - x0) / (y1 - y0))
    xs.sort()
    return xs


def _dentro(aneis, x, y):
    return sum(1 for c in _cruzamentos(aneis, y) if c < x) % 2 == 1


def _centroide(anel):
    soma_x = soma_y = soma_a = 0.0
    for i in range(len(anel) - 1):
        x0, y0 = anel[i]
        x1, y1 = anel[i + 1]
        cruz = x0 * y1 - x1 * y0
        soma_a += cruz
        soma_x += (x0 + x1) * cruz
        soma_y += (y0 + y1) * cruz

    if soma_a == 0:
        n = len(anel)
        return sum(p[0] for p in anel) / n, sum(p[1] for p in anel) / n
    return soma_x / (3 * soma_a), soma_y / (3 * soma_a)


def ponto_interno(geometria):
    """Ponto representativo em [lat, lon], garantidamente dentro do municipio.

    Este ponto e onde map.js le o campo interpolado para descrever o municipio
    em texto, entao ele precisa mesmo cair dentro do territorio: um ponto fora
    anunciaria a temperatura do vizinho.

    Nem o centro da bbox nem o centroide de area servem sozinhos. Municipios
    em forma de L ou de C -- comuns no litoral e no entorno das represas --
    poem os dois no vao. Entao: tenta-se o centroide, que e o ponto de aspecto
    mais natural, e so quando ele cai fora recorre-se a varredura, que devolve
    o meio do trecho interno mais largo encontrado.
    """
    tipo = geometria["type"]
    poligonos = (
        [geometria["coordinates"]] if tipo == "Polygon"
        else geometria["coordinates"]
    )

    # Maior poligono do municipio, com os seus furos: o continente, e nao uma
    # ilha ou um enclave.
    aneis, maior = None, -1.0
    for candidato in poligonos:
        a = area(candidato[0])
        if a > maior:
            maior, aneis = a, candidato

    x, y = _centroide(aneis[0])
    if _dentro(aneis, x, y):
        return [round(y, PRECISAO), round(x, PRECISAO)]

    sul = min(p[1] for p in aneis[0])
    norte = max(p[1] for p in aneis[0])

    melhor, largura = None, -1.0
    for k in range(1, VARREDURA):
        lat = sul + (norte - sul) * k / VARREDURA
        xs = _cruzamentos(aneis, lat)
        for i in range(0, len(xs) - 1, 2):
            if xs[i + 1] - xs[i] > largura:
                largura = xs[i + 1] - xs[i]
                melhor = ((xs[i] + xs[i + 1]) / 2, lat)

    if melhor is None:  # degenerado: fica o centroide mesmo
        return [round(y, PRECISAO), round(x, PRECISAO)]
    return [round(melhor[1], PRECISAO), round(melhor[0], PRECISAO)]


def main():
    analisador = argparse.ArgumentParser(description=__doc__)
    analisador.add_argument(
        "--qualidade", type=int, default=3, choices=[1, 2, 3, 4],
        help="detalhe da malha do IBGE; 4 e o maximo (arquivo bem maior)",
    )
    argumentos = analisador.parse_args()

    print("Baixando nomes dos municipios...")
    try:
        nomes = {
            str(m["id"]): m["nome"] for m in baixar(NOMES)
        }
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as erro:
        print("Falha ao obter os nomes: %s" % motivo(erro), file=sys.stderr)
        return 1

    print("Baixando a malha municipal (qualidade %d)..." % argumentos.qualidade)
    malha, url = obter_malha(argumentos.qualidade)
    if malha is None:
        print("Nenhuma das URLs devolveu a malha municipal. As mensagens acima "
              "dizem o que cada uma respondeu.", file=sys.stderr)
        return 1

    feicoes = []
    descartados = 0

    for feicao in malha.get("features", []):
        propriedades = feicao.get("properties") or {}
        codigo = str(propriedades.get("codarea", "")).strip()

        geometria, bbox = simplificar(feicao.get("geometry"))
        if geometria is None:
            descartados += 1
            continue

        feicoes.append({
            "type": "Feature",
            "properties": {
                "nome": nomes.get(codigo, codigo),
                "codigo": codigo,
                "centro": ponto_interno(geometria),
                "bbox": bbox,
            },
            "geometry": geometria,
        })

    if not feicoes:
        print("Nenhum municipio na resposta do IBGE.", file=sys.stderr)
        return 1

    feicoes.sort(key=lambda f: f["properties"]["nome"])

    colecao = {"type": "FeatureCollection", "features": feicoes}

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    with SAIDA.open("w", encoding="utf-8") as arquivo:
        arquivo.write("/* Gerado por tools/build-municipios.py. Nao editar. */\n")
        arquivo.write("/* Fonte: %s */\n" % url)
        arquivo.write("window.SP_MUNICIPIOS = ")
        # ensure_ascii deixa "Sao Paulo" como "S\u00e3o Paulo": o arquivo sai
        # em ASCII puro. Um <script src> classico herda a codificacao do
        # documento, e por file:// isso depende do navegador -- sem acentos no
        # arquivo, nao ha o que adivinhar errado. O atributo charset em
        # <script> resolveria, mas e obsoleto em HTML5 e o validador do W3C
        # aponta, o que custaria ponto no relatorio.
        json.dump(colecao, arquivo, ensure_ascii=True, separators=(",", ":"))
        arquivo.write(";\n")

    tamanho = SAIDA.stat().st_size / 1024
    print("%d municipios, %d descartados, %.0f kB em %s"
          % (len(feicoes), descartados, tamanho, SAIDA))

    sem_nome = [f for f in feicoes if f["properties"]["nome"] == f["properties"]["codigo"]]
    if sem_nome:
        print("Aviso: %d municipios ficaram sem nome (codigo no lugar)."
              % len(sem_nome), file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
