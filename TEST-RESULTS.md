# Lokalny odbiór — 2026-11-04

Środowisko: Docker Engine 29.9.3, kontener Linux amd64, Playwright 1.64.1,
Chromium, generator MF 1.1.46 / commit `8a18843db12d0013a417500bb2f98bfe49b7d2a8`.

## Zakres wykonanych testów

- Obraz zbudowany z Dockerfile; źródła MF pobrane z oficjalnego repozytorium, SHA-256 archiwum zweryfikowany.
- Uruchomienie przez Compose z siecią zewnętrzną `app_net`, localhost:3080, bez uprawnień root. Healthcheck: healthy.
- API: health 200; brak klucza 401; błędny XML, DTD i błędne Base64 400.
- Konwersja XML i JSON/Base64: HTTP 200, poprawny nagłówek PDF i SHA-256 wejścia.
- XML UTF-16: HTTP 200, hash dokładnych bajtów zachowany.
- Publiczny przykład MF: 3 strony.
- Syntetyczna faktura VAT: 2 strony, 123,00 PLN.
- Syntetyczna korekta: 2 strony, -123,00 PLN.
- Syntetyczna zaliczka: 2 strony, 123,00 PLN.
- Syntetyczny dokument z 70 pozycjami: 3 strony, 8610,00 PLN; ostatnia pozycja obecna.
- Odczyt tekstu PDF: numer faktury, numer KSeF, kwota brutto, polskie znaki i link QR.
- QR odczytany skanerem z obrazów wszystkich pięciu PDF-ów; zgodny z hashem oryginalnego XML.
- Strony wyrenderowane Popplerem i obejrzane wizualnie: tabele, kwoty, polskie znaki i QR czytelne.

Przykłady syntetyczne służą testom renderowania, nie są dokumentami do wysłania do KSeF.
PDF/XML/PNG testów pozostają w lokalnym `output/pdf`, poza Git. Repo zawiera wyłącznie
publiczny fixture MF i kod tworzący syntetyczne przypadki.

## Granice odbioru

Po uzyskaniu wyraźnej zgody użytkownika wykonano dodatkowy test jednej rzeczywistej
faktury sprzedażowej i jednej zakupowej z produkcyjnego KSeF. W obu przypadkach:
XML pobrano z poprawnym SHA-256, konwerter zwrócił PDF HTTP 200, numer faktury, numer
KSeF, netto, VAT, brutto i waluta w tekście PDF zgadzały się z metadanymi. Oba dokumenty
mają po 2 strony, wszystkie strony obejrzano. QR obu PDF-ów odczytano niezależnym
dekoderem ZBar i porównano z linkami w PDF (OpenCV nie odczytał kodu zakupu, ZBar
odczytał oba). PDF-y zapisano tylko lokalnie w ignorowanym output/pdf; danych faktur
nie zapisano w repozytorium ani w logach. Nie zapisywano dokumentów do Paperless
i nie tworzono workflow n8n. Pełna walidacja XSD nie jest częścią konwertera.
Podział stron pozostaje taki jak w oryginalnym generatorze MF: w krótkim przykładzie
VAT i zaliczki końcowa informacja o generatorze trafia na osobną stronę. Nie zmieniano
źródeł MF ani nie usuwano stron z dokumentu.

Audyt zależności wrappera podczas instalacji: 0 zgłoszeń. Pełne zależności upstream
MF mają zgłoszenia w narzędziach budowania; w audycie `--omit=dev` jedno umiarkowane
zgłoszenie dotyczy `i18next-http-backend`, którego używane wejście generatora nie
importuje. Runtime zawiera bundle potrzebnego kodu MF, nie cały katalog jego
node_modules. Ponawiać audyt i testy przy każdej aktualizacji.

## Powtórzenie

```bash
npm ci --ignore-scripts
npm test
docker compose -f compose.yaml -f compose.local.yaml up -d --build
# Ustaw API_KEY w środowisku z lokalnego magazynu sekretów.
node scripts/smoke-test.mjs
# Z zainstalowanym pypdf:
python3 scripts/verify-pdfs.py
# Podgląd stron, np.:
pdftoppm -scale-to 1400 -png output/pdf/correction.pdf output/pdf/correction
```
