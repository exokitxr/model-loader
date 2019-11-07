import './GLTFLoader.js';
import './FBXLoader.js';
import './GLTFExporter.js';
import './SkeletonUtils.js';
import './inflate.min.js';
import './gunzip.min.js';
import './ProgressivePromise.js';
import './untar.js';
import './zip.js';

const basePath = import.meta.url.replace(/[^\/]*$/, '');

const _getFileType = filename => {
  if (/\.(?:gltf|glb|vrm)$/.test(filename)) {
    return 'gltf';
  } else if (/\.fbx$/.test(filename)) {
    return 'fbx';
  } else if (/\.(?:tar\.gz|tgz|unitypackage)$/.test(filename)) {
    return 'tgz';
  } else if (/\.(?:zip)$/.test(filename)) {
    return 'zip';
  } else if (/\.(?:png|jpe?g)/) {
    return 'img';
  } else {
    return null;
  }
};
const _pathname2Filename = pathname => {
  const match = pathname.match(/([^\/]+)$/);
  return match && match[1];
};
const _filename2Ext = filename => {
  const match = filename.match(/\.([^\.]+)$/);
  return match ? match[1] : null;
};
const _patchModel = model => {
  const saved = THREE.SkeletonUtils.clone(model.scene);

  model.export = () => new Promise((accept, reject) => {
    new THREE.GLTFExporter().parse(saved, ab => {
      accept(ab);
    }, {
      binary: true,
    });
  });
};
const _loadModelFilesystem = async filesystem => {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const match = url.match(/([^\/]+)$/);
    if (match) {
      const filename = match[1];
      const file = filesystem.find(file => file.filename === filename);
      if (file) {
        url = file.url;
      } else {
        const ext = _filename2Ext(filename);
        if (ext) {
          const file = filesystem.find(file => file.ext === ext);
          if (file) {
            url = file.url;
          }
        }
      }
    }
    return url;
  });

  const modelFiles = filesystem.filter(file => /\.(?:fbx|gltf|glb)/.test(file.pathname)).map(file => {
    const pathnamePrefix = file.pathname.replace(/[^\/]+$/, '');
    const numSiblingFiles = filesystem.filter(file => file.pathname.startsWith(pathnamePrefix)).length;
    return {
      file,
      numSiblingFiles,
    };
  }).sort((a, b) => {
    const diff = b.numSiblingFiles - a.numSiblingFiles;
    if (diff !== 0) {
      return diff;
    } else {
      return +/unity/i.test(b.file.filename) - +/unity/i.test(a.file.filename);
    }
  }).map(({file}) => file);
  if (modelFiles.length > 0) {
    const modelFile = modelFiles[0];
    // console.log('got model file', modelFile);
    const modelFileUrl = modelFile.url;
    console.log(`using model file: ${modelFile.pathname}`);
    if (/\.fbx$/.test(modelFile.pathname)) {
      const model = await new Promise((accept, reject) => {
        new THREE.FBXLoader(manager).load(modelFileUrl, scene => {
          accept({scene});
        }, function onprogress() {}, reject);
      });
      return model;
    } else {
      const model = await new Promise((accept, reject) => {
        new THREE.GLTFLoader(manager).load(modelFileUrl, accept, xhr => {}, reject);
      });
      return model;
    }
  } else {
    throw new Error('no model file in package');
  }
};
const _readAsArrayBuffer = blob => new Promise((accept, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    accept(reader.result);
  };
  reader.onerror = reject;
  reader.readAsArrayBuffer(blob);
});
const loadModelUrl = async (href, filename = href) => {
  const fileType = _getFileType(filename);
  if (fileType === 'gltf') {
    const model = await new Promise((accept, reject) => {
      new THREE.GLTFLoader().load(href, accept, xhr => {}, reject);
    });
    _patchModel(model);
    return model;
  } else if (fileType === 'fbx') {
    const model = await new Promise((accept, reject) => {
      new THREE.FBXLoader().load(href, scene => {
        accept({scene});
      }, xhr => {}, reject);
    });
    _patchModel(model);
    return model;
  } else if (fileType === 'zip') {
    const unitypackageRes = await fetch(href);
    const blob = await unitypackageRes.blob();
    const reader = await new Promise((accept, reject) => {
      zip.createReader(new zip.BlobReader(blob), accept, reject);
    });
    const entries = await new Promise((accept, reject) => {
      reader.getEntries(accept);
    });

    const filesystem = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const pathname = entry.filename;
      const filename = _pathname2Filename(pathname);
      const ext = _filename2Ext(filename);
      const blob = await new Promise((accept, reject) => {
        entry.getData(new zip.BlobWriter('application/octet-stream'), accept, function onprogress(current, total) {});
      });
      const url = URL.createObjectURL(blob);
      filesystem.push({
        pathname,
        filename,
        ext,
        url,
      });
      // console.log('got blob', entry, blob, pathname, filename, url);
    }
    // console.log('got filesystem', filesystem);

    const model = await _loadModelFilesystem(filesystem);
    _patchModel(model);
    return model;
  } else if (fileType === 'tgz') {
    const unitypackageRes = await fetch(href);
    const arraybuffer = await unitypackageRes.arrayBuffer();
    const inflatedArrayBuffer = new Zlib.Gunzip(new Uint8Array(arraybuffer)).decompress().buffer;
    const files = await untar(inflatedArrayBuffer);
    // console.log('got files', files);
    // window.files = files;

    const filesystem = [];
    for (let j = 0; j < files.length; j++) {
      const file = files[j];
      const {name} = file;
      const match = name.match(/^([a-zA-Z0-9]+)\/pathname$/);
      if (match) {
        const pathname = new TextDecoder().decode(await _readAsArrayBuffer(file.blob));
        const id = match[1];
        const assetFileName = `${id}/asset`;
        const assetFile = files.find(file => file.name === assetFileName);
        if (assetFile) {
          const filename = _pathname2Filename(pathname);
          const url = assetFile.getBlobUrl();
          filesystem.push({
            pathname,
            filename,
            url,
          });
        }
      }
    }
    const model = await _loadModelFilesystem(filesystem);
    _patchModel(model);
    return model;
  } else if (fileType === 'img') {
    const img = await new Promise((accept, reject) => {
      const img = new Image();
      img.onload = () => {
        accept(img);
      };
      img.onerror = reject;
      img.crossOrigin = 'Anonymous';
      img.src = href;
    });
    const model = await new Promise((accept, reject) => {
      new THREE.GLTFLoader().load(`${basePath}minecraft.glb`, accept, xhr => {}, reject);
    });
    const texture = new THREE.Texture(img, THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping, THREE.NearestFilter, THREE.LinearMipmapLinearFilter, THREE.RGBAFormat, THREE.UnsignedByteType, 16, THREE.LinearEncoding);
    texture.flipY = false;
    texture.needsUpdate = true;
    model.scene.traverse(o => {
      if (o.isSkinnedMesh) {
        o.material.map = texture;
      }
    });
    _patchModel(model);
    return model;
  } else {
    throw new Error(`unknown file type: ${filename} (${fileType})`);
  }
};

const ModelLoader = {
  loadModelUrl,
};
export default ModelLoader;