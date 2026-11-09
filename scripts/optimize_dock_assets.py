"""Regenerate display-sized Dock WebP derivatives; preserve owner JPEG originals.

Optional offline authoring dependency: Pillow. The Python runtime/builder has
no Pillow dependency. 704x384 preserves the original 1408x768 aspect ratio;
the unchanged SVG crop has about 270 pixels for a roughly 64-pixel icon.
"""
from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parents[1]/'frontend/vanilla/images/dock/neon'
for source in sorted(root.glob('*.jpg')):
    with Image.open(source) as image:
        assert image.size==(1408,768),f'Unexpected source extent: {source.name}'
        image.convert('RGB').resize((704,384),Image.Resampling.LANCZOS).save(
            source.with_suffix('.webp'),'WEBP',quality=90,method=6)
