# ksef-xml-to-pdf

Wewnętrzna usługa HTTP do wizualizacji faktur KSeF XML jako PDF. Przeznaczona do n8n i wdrożenia przez Portainer **Docker Standalone** w istniejącej sieci `app_net`.

Generator: [CIRFMF/ksef-pdf-generator](https://github.com/CIRFMF/ksef-pdf-generator). Oryginalne źródła MF są pobierane **bezpośrednio podczas budowania obrazu**. Nie utrzymujemy ich kopii ani poprawek w tym repozytorium. `upstream.lock.json` określa commit i SHA-256 archiwum. Biblioteki MF są instalowane według oryginalnego `package-lock.json`.

## Co robi usługa

- Przyjmuje XML FA(1), FA(2) lub FA(3) i znany numer KSeF, zwraca binarny PDF z tekstem i kodem QR.
- Oblicza QR z dokładnych bajtów wejściowego XML, daty wystawienia i NIP sprzedawcy; wybiera adres QR według środowiska.
- Uruchamia niezmieniony generator MF we własnym Chromium. Wszystkie żądania sieciowe strony renderującej są blokowane; fonty i tłumaczenia są lokalne.
- Wymaga własnego klucza API. Nie loguje treści XML, numerów faktur ani tokenów. Nie przechowuje faktur na dysku; odpowiedź zapisuje klient.
- Nie łączy się z KSeF, Paperless ani PostgreSQL. **Nie przekazuj tutaj tokenu KSeF ani tokenu Paperless.**
- Sprawdza poprawność składni XML i podstawowe dane do renderowania. Nie jest walidatorem XSD ani potwierdzeniem autentyczności faktury; hash względem KSeF powinien sprawdzić klient pobierający XML.

Zakres v1 obejmuje faktury FA. PEF, UPO i FA_RR nie są udostępnione przez to API, choć upstream rozwija również te formaty. Obsługujemy dokumenty już posiadające numer KSeF; usługa nie przygotowuje faktur offline przed wysłaniem.

## Uruchomienie lokalne

Wymagane: Docker Engine i Compose v2. Przygotuj `.env`:

```bash
cp .env.example .env
# Wygeneruj API_KEY: openssl rand -hex 32
# Wpisz wygenerowany klucz do .env.
docker network inspect app_net >/dev/null 2>&1 || docker network create app_net
docker compose -f compose.yaml -f compose.local.yaml up -d --build
curl --fail http://127.0.0.1:3080/healthz
```

Port testowy jest związany wyłącznie z `127.0.0.1`. Sam `compose.yaml` nie publikuje portu hosta. Obraz działa jako użytkownik nieuprzywilejowany; Chromium korzysta z izolacji kontenera. Nie udostępniać API anonimowo w Internecie.

## Portainer

### Wariant zalecany: obraz GHCR

Workflow `.github/workflows/container.yml` po pushu do `main` buduje obraz, testuje konwersję i publikuje:

```text
ghcr.io/eletor-com/ksef-xml-to-pdf:latest
ghcr.io/eletor-com/ksef-xml-to-pdf:sha-<commit>
```

1. Poczekaj na poprawny wynik GitHub Actions. Dla prywatnego obrazu dodaj w Portainerze rejestr `ghcr.io` z kontem mającym `read:packages` i dostęp do pakietu.
2. Na docelowym Dockerze musi istnieć sieć `app_net`.
3. Utwórz Stack z repozytorium, wskazując **`portainer-stack.yaml`**, albo wklej ten plik do edytora stosu.
4. W zmiennych stosu ustaw `API_KEY` (losowy, co najmniej 32 znaki), `KSEF_ENVIRONMENT=production` i `CONVERTER_IMAGE`.
5. Po testach użyj konkretnego tagu SHA lub digestu obrazu zamiast `latest`. Zachowaj poprzedni digest do wycofania aktualizacji.
6. n8n podłączone do tej samej sieci wywołuje `http://ksef-xml-to-pdf:3000/convert`.

Kontener ma stałą nazwę `ksef-xml-to-pdf` (ustawienie `container_name`), niezależnie od nazwy stosu. Na jednym hoście można uruchomić jeden kontener o tej nazwie. Po aktualizacji stosu Compose odtworzy kontener z nową nazwą.

Plik Portainera używa gotowego obrazu, nie wymaga obsługi budowania Dockerfile przez Portainer. To konfiguracja Docker Standalone, nie Docker Swarm.

### Wariant bez rejestru obrazów

Na hoście docelowym sklonuj repozytorium i zbuduj obraz:

```bash
docker build -t eletor/ksef-xml-to-pdf:1.0.0 .
```

W Portainerze ustaw `CONVERTER_IMAGE=eletor/ksef-xml-to-pdf:1.0.0` i wyłącz wymuszanie pobierania obrazu z rejestru. Obraz musi istnieć na tym samym Dockerze, do którego podłączony jest Portainer.

## API

### `GET /healthz`

Bez autoryzacji. HTTP 200, gdy proces i Chromium działają; odpowiedź zawiera commit MF. Healthcheck nie zastępuje testu konwersji.

### `POST /convert` — XML

```bash
# API_KEY należy ustawić lokalnie; nie umieszczaj prawdziwego klucza w historii komend.
curl --fail-with-body \
  -H "Authorization: Bearer ${API_KEY}" \
  -H 'Content-Type: application/xml' \
  -H 'X-KSeF-Number: 5265877635-20251031-000000000001-00' \
  --data-binary @test/fixtures/mf-fa3.xml \
  --output invoice.pdf \
  http://127.0.0.1:3080/convert
```

Numer w przykładzie jest syntetyczny: służy wyłącznie do testu renderowania, nie oznacza istnienia faktury w KSeF. Opcjonalny `X-KSeF-Acquired-At` przyjmuje datę przyjęcia faktury z metadanych KSeF, w formacie ISO 8601.

### `POST /convert` — JSON

```json
{
  "xmlBase64": "<oryginalne bajty XML zakodowane Base64>",
  "ksefNumber": "<numer z metadanych KSeF>",
  "acquiredAt": "2026-11-04T10:00:00Z"
}
```

`Content-Type: application/json`, ten sam nagłówek `Authorization`. `acquiredAt` jest opcjonalne. Odpowiedź to PDF, nie JSON/Base64. Nagłówki `X-XML-SHA256` i `X-Renderer-Version` pozwalają powiązać wynik z XML i wersją generatora. `Cache-Control: no-store`.

Kody: 400 błędne dane, 401 klucz API, 413 rozmiar, 415 typ danych, 422 nieudana konwersja, 429 kolejka zajęta (`Retry-After`), 503 renderer niedostępny. Maksymalnie 2 MiB XML, jedna aktywna konwersja, najwyżej cztery przyjęte zadania łącznie, limit renderowania 60 sekund na zadanie. Klient powinien dopuścić czas na kolejkę i ponawiać 429/503; nie ponawiać bez końca błędnego XML.

### n8n

W HTTP Request użyj metody POST, URL wewnętrznego, credentials Header Auth z `Authorization: Bearer ...`, typu body XML i oryginalnego pliku binarnego. Ustaw `X-KSeF-Number` z metadanych. Alternatywnie wyślij JSON z Base64 oryginalnego XML. Odpowiedź odbieraj jako plik binarny PDF. Nie przepisuj XML przez parser przed konwersją — zmieniłoby to hash QR. Ten projekt nie tworzy workflow w n8n.

## Aktualizacja MF

Zamiast kopiować pliki, wybierz pełny SHA nowego commita z oficjalnego repozytorium:

```bash
npm ci --ignore-scripts
npm run upstream:update -- PELNY_40_ZNAKOWY_SHA_COMMITA_MF
npm ci --prefix upstream/mf --ignore-scripts
npm run build
npm test
docker compose -f compose.yaml -f compose.local.yaml up -d --build
# Ustaw API_KEY w środowisku terminala z lokalnego magazynu sekretów.
node scripts/smoke-test.mjs
```

Polecenie aktualizuje tylko `upstream.lock.json` i lokalny ignorowany katalog `upstream/mf`. Źródła MF pozostają niezmienione. Przed zatwierdzeniem nowego locka obejrzyj PDF-y i sprawdź kwoty, korekty, polskie znaki, długie tabele oraz QR. Następnie commit i push uruchomią budowanie obrazu. Aktualizacja może wymagać dostosowania adaptera, jeśli upstream zmieni publiczny interfejs — nie wdrażamy automatycznie nieprzetestowanej gałęzi `main` MF.

Do odtworzenia przypiętej wersji lokalnie: `npm run upstream:sync`, potem `npm ci --prefix upstream/mf --ignore-scripts` i `npm run build`. Docker wykonuje te kroki sam.

## Testy i wyniki

`npm test` sprawdza m.in. tożsamość bajtów XML, hash QR, UTF-16, niepoprawne daty i odrzucenie DTD. `node scripts/smoke-test.mjs` sprawdza uruchomione API, autoryzację, błędy danych oraz generuje przykładowe PDF-y do `output/pdf/` (ignorowane przez Git). Wymaga `API_KEY`, opcjonalnie `CONVERTER_URL`.

Wyniki lokalnego odbioru i ograniczenia: [TEST-RESULTS.md](TEST-RESULTS.md).

## Licencje

Wrapper: MIT. Kod generatora pobierany z MF ma plik LICENSE MIT; podczas builda zachowujemy go w obrazie jako `/app/dist/LICENSE-MF`. Upstream deklaruje w package.json ISC, a w LICENSE MIT — tej niespójności metadanych nie poprawiamy w źródłach MF. Publiczny fixture testowy pochodzi z `assets/invoice.xml` wskazanego commita MF, z tą samą licencją (zachowaną w `test/fixtures/LICENSE-MF`).
