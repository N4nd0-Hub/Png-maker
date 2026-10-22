# Recorta PNG

Editor de recorte e recoloração, publicado em https://n4nd0-hub.github.io/Png-maker/.

## Como usar

1. Abra, arraste ou cole uma imagem.
2. Experimente **Remover fundo complexo**, que reconhece o primeiro plano com IS-Net. O modelo tem aproximadamente 45 MB e é carregado sob demanda, com progresso e cancelamento.
3. Use **Manter região** e **Remover região** para corrigir uma região. Depois da remoção detalhada, essas correções acompanham as cores conectadas às marcações, com tolerância ajustável, e preservam o restante da máscara.
4. Outra opção é **Marcar personagem**: clique ou risque dentro dele. **Contorno assistido** usa o contorno desenhado como orientação para o MediaPipe.
5. Compare o original e o recorte. A aba **Ajustar** oferece pincéis, limpeza de pequenos resíduos, redução de halo claro, suavização e margem. **Cores** preserva os controles de recoloração por espectro.
6. Baixe um PNG transparente. A imagem mantém a resolução de seus pixels e as bordas vazias são recortadas.

Fundos e personagens com cores muito parecidas ainda podem exigir marcações ou pincéis. A limpeza não é aplicada automaticamente: partes separadas, como chamas e efeitos, são preservadas por padrão.

## Funcionamento

- Site estático, sem compilação, conta, chave de API ou servidor de processamento.
- A imagem é processada no dispositivo. Downloads externos carregam o motor e os modelos, sem enviar a arte.
- Inferência e leitura do fundo uniforme rodam em um Web Worker. Trocar de imagem ou cancelar invalida o trabalho anterior.
- O modo detalhado usa o IS-Net quantizado dos assets IMG.LY 1.7.0, em ONNX Runtime Web 1.22.0. O manifesto fixa tamanhos e hashes; os blocos baixados são conferidos e podem ficar no cache local.
- A seleção guiada usa MediaPipe Tasks Vision 1.1.1 e Magic Touch v2, versão 1.
- A máscara é ajustada às bordas da imagem original. A prévia e a exportação usam a mesma composição.
- Desfazer/refazer restaura a máscara, suas marcações e as correções com pincel. O histórico tem limite de memória.
- A seleção rápida e o recorte por fundo uniforme não exigem o modelo detalhado. As ferramentas manuais não exigem carregar modelos.

O modo detalhado exige um navegador com WebAssembly e Web Workers. Em dispositivos com pouca memória, use as marcações guiadas ou as ferramentas manuais. O site limita a abertura a 24 megapixels e 8192 pixels por lado para evitar canvas incompatíveis.

## Arquivos

- `index.html`: interface e diálogos.
- `styles.css`: aparência e adaptação para celular.
- `app.js`: interações, histórico, recoloração, prévia e exportação.
- `segment-worker.js`: inferência, downloads e processamento fora da interface.
- `engine.js`: operações de máscara e bordas.
- `isnet-model.json`: manifesto do modelo quantizado.
- `tests/engine.test.cjs`: regressões de preservação de detalhes, fundo liso e bordas.

Para desenvolver, sirva a pasta por HTTP/HTTPS. Web Workers precisam dos arquivos separados; abrir apenas o HTML via `file://` não equivale ao site publicado.

```sh
node --test tests/*.test.cjs
```

## Referências e licenças

Consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Os modelos e os motores externos mantêm suas licenças e autores originais.
