"""Optional browser smoke. Open a server on localhost:8765 first; API is mocked (no real OAuth)."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://localhost:8765/'


def test_page(browser, viewport, screenshot, mobile=False):
    context = browser.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile)
    page = context.new_page()
    errors = []
    requests = []
    remote = {'version': 0, 'data': None}
    page.on('pageerror', lambda error: errors.append(str(error)))

    def identity_api(route):
        request = route.request
        path = request.url.split('localhost:3000', 1)[-1]
        requests.append((request.method, path))
        headers = {'Access-Control-Allow-Origin': URL.rstrip('/'), 'Access-Control-Allow-Credentials': 'true', 'Content-Type': 'application/json'}
        if request.method == 'OPTIONS':
            route.fulfill(status=204, headers={**headers, 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'content-type'}, body='')
        elif path == '/api/session':
            route.fulfill(status=200, headers=headers, body=json.dumps({'authenticated': True, 'driveConnected': True, 'user': {'id': 12, 'name': 'Alex Martin', 'email': 'alex@example.test', 'picture': 'https://profile.test/avatar.svg'}}))
        elif path == '/api/sync/batch-and-co' and request.method == 'GET':
            route.fulfill(status=200, headers=headers, body=json.dumps({'appId': 'batch-and-co', **remote}))
        elif path == '/api/sync/batch-and-co' and request.method == 'PUT':
            body = request.post_data_json
            if body['version'] != remote['version']:
                route.fulfill(status=409, headers=headers, body=json.dumps({'error': {'code': 'SYNC_CONFLICT', 'message': 'Conflit'}}))
            else:
                remote['version'] += 1
                remote['data'] = body['data']
                route.fulfill(status=200, headers=headers, body=json.dumps({'appId': 'batch-and-co', 'version': remote['version']}))
        else:
            route.fulfill(status=404, headers=headers, body=json.dumps({'error': {'code': 'NOT_FOUND'}}))

    def static_file(route):
        path = route.request.url.split('localhost:8765', 1)[-1].split('?', 1)[0].lstrip('/')
        path = path or 'index.html'
        file = ROOT / 'preview' / path
        content_type = 'text/javascript' if path.endswith(('.js', '.mjs')) else 'text/css' if path.endswith('.css') else 'text/html'
        route.fulfill(status=200, body=file.read_bytes(), content_type=content_type)

    page.route('http://localhost:8765/**', static_file)
    page.route('http://localhost:3000/**', identity_api)
    page.route('https://profile.test/avatar.svg', lambda route: route.fulfill(status=200, content_type='image/svg+xml', body='<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><circle cx="30" cy="30" r="30" fill="#bad89b"/></svg>'))
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_function("document.querySelector('#identity-status').textContent === 'Drive connecté'")
    assert page.locator('#week-grid .day-card').count() == 7
    assert page.locator('#profile-picture').is_visible() or page.locator('#profile-picture').get_attribute('src')
    page.locator('#profile-trigger').click()
    assert page.locator('#profile-name').inner_text() == 'Alex Martin'
    assert page.locator('#profile-sync').is_visible()
    page.screenshot(path=str(ROOT / screenshot), full_page=True)
    page.locator('#profile-sync').click()
    page.locator('#identity-conflict-dialog').wait_for(state='visible')
    assert 'Aucune sauvegarde' in page.locator('#identity-conflict-message').inner_text()
    page.locator('#identity-push').click()
    page.wait_for_function("document.querySelector('#toast').textContent.includes('Première sauvegarde')")
    assert remote['version'] == 1 and remote['data']['schemaVersion'] == 3
    page.locator('#profile-menu').evaluate('(element) => element.open = false')
    page.locator('#week-grid [data-add-meal]').first.click()
    page.locator('#meal-name').fill('Collation test')
    page.locator('#save-meal').click()
    page.locator('#profile-trigger').click()
    assert page.locator('#identity-status').inner_text() == 'À synchroniser'
    assert ('PUT', '/api/sync/batch-and-co') in requests
    assert not errors, errors
    context.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        test_page(browser, {'width': 1440, 'height': 900}, 'preview-identity-desktop.png')
        test_page(browser, {'width': 390, 'height': 844}, 'preview-identity-mobile.png', mobile=True)
        browser.close()
    print('Chromium: desktop and mobile identity smoke passed')
