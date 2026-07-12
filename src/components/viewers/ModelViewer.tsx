import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ModelAsset } from '../../../shared/types';

export function ModelViewer({ asset }: { asset: ModelAsset }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 640;
    const height = mount.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15181d);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(1, 1, 1);
    scene.add(key);

    // Build a shared texture once, if the model resolved one.
    let texture: THREE.DataTexture | null = null;
    if (asset.texture) {
      texture = new THREE.DataTexture(
        // Fresh ArrayBuffer-backed copy (DataTexture rejects SharedArrayBuffer-backed).
        new Uint8ClampedArray(asset.texture.pixels),
        asset.texture.width,
        asset.texture.height,
        THREE.RGBAFormat,
      );
      texture.needsUpdate = true;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
    }

    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];

    for (const obj of asset.objects) {
      if (obj.triangleCount === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(obj.positions, 3));
      if (obj.colors) geometry.setAttribute('color', new THREE.BufferAttribute(obj.colors, 3));
      const useTexture = texture && obj.uvs;
      if (useTexture) {
        // PSX UVs are 0..255 texel coords within the texture page.
        const uv = new Float32Array((obj.uvs!.length / 2) * 2);
        for (let i = 0; i < obj.uvs!.length; i += 2) {
          uv[i] = obj.uvs![i] / asset.texture!.width;
          uv[i + 1] = obj.uvs![i + 1] / asset.texture!.height;
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
      geometry.computeVertexNormals();
      disposables.push(geometry);

      const material = useTexture
        ? new THREE.MeshBasicMaterial({ map: texture!, side: THREE.DoubleSide })
        : new THREE.MeshPhongMaterial({
            vertexColors: !!obj.colors,
            color: obj.colors ? 0xffffff : 0x9aa4b2,
            flatShading: true,
            side: THREE.DoubleSide,
          });
      disposables.push(material);
      group.add(new THREE.Mesh(geometry, material));
    }
    // Orientation fix: IVM item models come in upside-down and rotated 90°.
    // (Targeted to IVM so TMD/EMD, which look correct, aren't regressed.)
    if (asset.sourceExt === 'ivm') {
      group.rotation.x = Math.PI;
      group.rotation.z = Math.PI / 2;
    }
    scene.add(group);

    // Frame the model (bounds computed after the orientation fix).
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 100;
    group.position.sub(center);
    camera.position.set(0, 0, size * 1.2);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      texture?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [asset]);

  const total = asset.objects.reduce((n, o) => n + o.triangleCount, 0);
  return (
    <div className="model-viewer">
      <div className="model-meta">
        {asset.objects.length} object(s) · {total} triangles
        {asset.texture ? ` · textured ${asset.texture.width}×${asset.texture.height}` : ' · vertex color'}
      </div>
      <div ref={mountRef} className="model-stage" />
    </div>
  );
}
