# Componentes de terceiros

O editor baixa componentes externos sob demanda. Os binários dos motores e os pesos dos modelos não estão incluídos neste repositório.

## MediaPipe

- Google MediaPipe Tasks Vision 1.1.1 e Interactive Segmenter / Magic Touch v2.
- Licença Apache 2.0.
- Fonte: https://github.com/google-ai-edge/mediapipe
- Licença: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE
- Documentação: https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter/web_js
- Distribuição do motor: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/

## ONNX Runtime

- Microsoft ONNX Runtime Web 1.22.0.
- Licença MIT.
- Fonte e licença: https://github.com/microsoft/onnxruntime
- Distribuição: https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/

## IS-Net / IMG.LY model assets

- IS-Net, do projeto Dichotomous Image Segmentation, de Xuebin Qin e colaboradores.
- Modelo quantizado `isnet_quint8`, distribuído no pacote de dados IMG.LY 1.7.0.
- Fonte do projeto e referência dos assets: https://github.com/imgly/background-removal-js
- Licença indicada pela distribuição IMG.LY: AGPL 3.0. Texto e condições: https://github.com/imgly/background-removal-js/blob/main/LICENSE.md
- Projeto original: https://github.com/xuebinqin/DIS
- Assets originais: https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/resources.json

`isnet-model.json` conserva os nomes, hashes, offsets e tamanho do manifesto dessa distribuição. O editor implementa sua própria preparação dos pixels e composição usando ONNX Runtime; não incorpora o pacote JavaScript de remoção de fundo da IMG.LY. Os arquivos do modelo são obtidos diretamente da distribuição indicada acima.

Nenhum arquivo de imagem enviado por quem utiliza o editor é transmitido a esses fornecedores.
