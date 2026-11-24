# CABra v2

Repositório da versão 2 do **CABra** (Catchment Attributes for Brazil) e do site do projeto.

> Almagro, A., Oliveira, P. T. S., Meira Neto, A. A., Roy, T., and Troch, P.: CABra: a novel large-sample dataset for Brazilian catchments, *Hydrol. Earth Syst. Sci.*, 25, 3105–3135, https://doi.org/10.5194/hess-25-3105-2021, 2021.
> Dados da v1: https://doi.org/10.5281/zenodo.4070146

## Site (`docs/`)

Site estático publicado pelo GitHub Pages (Settings → Pages → *Deploy from a branch* → `main` / `docs`). Substitui o antigo app Shiny (`thecabradataset.shinyapps.io/CABra`).

- **Mapa**: as 735 estações, colorindo por bioma ou atributo; ao clicar, mostra o contorno da bacia, atributos principais, cobertura e textura do solo e as séries diárias de precipitação e vazão (com zoom e download em CSV).
- **Atributos**: as nove classes de atributos em tabelas ordenáveis e filtráveis, com download em CSV.
- **Sobre**: descrição, citação, contato e apoio. Português e inglês.

Estrutura:

```
docs/
  index.html
  assets/css, assets/js, assets/img
  assets/vendor/   Leaflet 1.9.4 e uPlot 1.6.30 (cópias locais, licenças incluídas)
  data/            gerado por site_tools/build_site_data.py
    catchments.json, attributes.json, boundaries/<id>.json, series/<id>.json
```

Todo acesso a dados passa por `docs/assets/js/data.js`. Para migrar para um banco/API no futuro, basta trocar essas funções (ou definir `window.CABRA_DATA_BASE`) mantendo o formato dos JSON; o resto do site não muda.

### Regenerar os dados

```
pip install pandas pyshp shapely
python site_tools/build_site_data.py <pasta_do_app_shiny_antigo> docs
```

Quando a v2 estiver pronta, o script será adaptado para ler as saídas novas (período até 2025).

### Testar localmente

```
cd docs && python -m http.server 8000
```
