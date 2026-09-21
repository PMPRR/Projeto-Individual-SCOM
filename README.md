# Projeto Individual de SCOM
Este projeto tem o objetivo de criar um site confiável agregador de dados metereológicos do estado de São Paulo.
Este site utiliza de dados públicos e submetidos por estações privadas para criar um mapa interativo e confiável para saber quais são as condições metereológicas a cada instante.

## Estrutura do Projeto
```
.
├── index.html                  Página inicial
├── pages/
│   ├── map.html                Mapa interativo
│   ├── login.html              Autenticação
│   └── signup.html             Cadastro
├── assets/
│   ├── css/
│   │   ├── themes.css          Variáveis :root — cores, temas e rampas de dados
│   │   ├── style.css           Base comum: tipografia, cabeçalho, rodapé, botões
│   │   ├── home.css            Página inicial
│   │   ├── map.css             Mapa e painéis de controle
│   │   └── auth.css            Formulários de login e cadastro
│   ├── js/
│   │   ├── script.js           Menus do cabeçalho e alternância de tema
│   │   ├── map.js              Montagem do mapa, camadas e interações
│   │   ├── campo.js            Campos contínuos vetoriais (window.ClimaCampo)
│   │   └── auth.js             Melhorias progressivas dos formulários
│   ├── data/                   Gerado por tools/ — não versionado
│   ├── img/                    Ilustrações em WebP, com variantes responsivas
│   └── vendor/leaflet/         Leaflet 1.9.4, versionado para funcionar offline
├── tools/
│   ├── build-sp-geo.py         Malha do Estado, relevo e curvas de nível
│   ├── build-municipios.py     Divisas municipais (IBGE)
│   ├── contornos.py            Curvas de nível a partir do MDE
│   └── fonte_topodata.py       Download e cache das folhas TOPODATA
├── docs/
│   ├── Wifeframes/             Wireframes iniciais em SVG
│   └── *.pdf                   Enunciados dos trabalhos
├── pyproject.toml              Dependências dos scripts de build
└── README.md
```
## Requisitos
 
**Para visualizar o site:** apenas um navegador moderno. Nenhum servidor,
nenhuma chave de API, nenhuma instalação.
 
**Para regerar os dados geográficos do mapa (opcional):**
 
| Programa | Versão | Necessário para |
|---|---|---|
| Python | ≥ 3.14 | todos os scripts de `tools/` |
| [uv](https://docs.astral.sh/uv/) | qualquer | gerenciar o ambiente (opcional, mas recomendado) |
| numpy | ≥ 2.5.3 | curvas de nível e sombreamento do relevo |
 
A malha do Estado (`--geo`) e a malha municipal não dependem de nada além da
biblioteca padrão. Os passos de relevo baixam dados do INPE e usam numpy.
## Como Compilar
```sh
python tools/build-sp-geo.py
```
---
 
## Como executar
 
### 1. Clonar o repositório
 
```sh
git clone https://github.com/<usuario>/Projeto-Individual-SCOM.git
cd Projeto-Individual-SCOM
```

### 2. Como gerar os dados do mapa
 
Os arquivos de `assets/data/` são derivados de fontes públicas e podem ser
reconstruídos a qualquer momento. Com `uv`:
 
```sh
uv sync                                       # cria o ambiente e instala numpy
uv run python tools/build-sp-geo.py           # malha do Estado + curvas de nível
uv run python tools/build-municipios.py       # divisas dos 645 municípios
```
 
### 3. Abrir o site
 
Abra `index.html` diretamente no navegador — duplo clique no arquivo, ou:
 
```sh
xdg-open index.html     # Linux
open index.html         # macOS
start index.html        # Windows
```
 
O site funciona pelo protocolo `file://`, sem servidor local. Todas as páginas,
estilos, scripts e o próprio Leaflet estão versionados no repositório
(`assets/vendor/`); nada é carregado da rede em tempo de execução.
 
> **Atenção:** a página do mapa precisa dos arquivos de `assets/data/`, que são
> gerados pelos scripts de `tools/` e **não** ficam versionados no Git (veja a
> seção seguinte). Sem eles, `pages/map.html` abre normalmente, mas exibe
> *"Não foi possível carregar a malha do Estado."* no lugar do mapa. O pacote
> `.zip` da entrega já inclui `assets/data/` pronto — neste caso basta abrir
> `index.html`.
 
### 4. Servidor local (alternativa)
 
Opcional; útil para auditorias do Lighthouse, que exigem `http://`:
 
```sh
python -m http.server 8000
# depois acesse http://localhost:8000
```
---

## Roadmap
 - [x] Definição do projeto, estrutura e softwares utilizados.
 - [x] Estrutura do pagina inicial
 - [x] Estrutura do pagina com mapa


## Autor:
Paulo de Melo Pereira Rodrigues Ramalho
