"""Verify smoke-test PDF text and amounts. Requires pypdf; no production inputs."""
from pathlib import Path
from decimal import Decimal
import xml.etree.ElementTree as ET
from pypdf import PdfReader

for path in sorted(Path('output/pdf').glob('*.pdf')):
    xml = path.with_suffix('.xml')
    if not xml.exists():
        continue
    root = ET.fromstring(xml.read_bytes())
    ns = {'f': root.tag.split('}')[0].strip('{')}
    reader = PdfReader(path)
    text = '\n'.join(page.extract_text() for page in reader.pages)
    compact = ''.join(text.split())
    number = root.findtext('f:Fa/f:P_2', namespaces=ns)
    amount = root.findtext('f:Fa/f:P_15', namespaces=ns)
    expected = f'{Decimal(amount):.2f}'.replace('.', ',')
    assert ''.join(number.split()) in compact, (path.name, 'invoice number absent')
    assert expected in compact, (path.name, 'gross amount absent')
    assert '5265877635-20251031-000000000001-00' in compact
    assert '/invoice/5265877635/31-10-2025/' in compact
    if path.stem != 'mf-fa3':
        assert all(s in text for s in ['Łódź', 'Gdańsk', 'Zażółć']), path.name
    if path.stem == 'multipage':
        assert 'numer70' in compact and len(reader.pages) >= 3
    print(f'{path.name}: PASS, {len(reader.pages)} pages, amount/number/QR link/text verified')
