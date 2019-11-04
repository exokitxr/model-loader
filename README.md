# Exokit Model Loader

```
import ModelLoader from 'https://model-loader.exokit.org/model-loader.js';

// ...


const model = await ModelLoader.loadModelUrl('model.zip'); // contains model.glb
const scene = new THREE.Scene();
scene.add(model);
```