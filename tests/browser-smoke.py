"""Browser smoke test offline via set_content (no navigation/network required)."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

project=Path(__file__).resolve().parents[1]
preview=project/'preview'
html=(preview/'index.html').read_text()
css=(preview/'assets/css/main.css').read_text()
domain=(preview/'assets/js/domain.mjs').read_text().replace('export function ','function ')
app=(preview/'assets/js/app.js').read_text().replace('import { calculateRecipeTotals, buildShoppingList } from "./domain.mjs";', '')
html=html.replace('<link rel="stylesheet" href="/assets/css/main.css">', '<style>'+css+'</style>')
html=html.replace('<script type="module" src="/assets/js/app.js"></script>', '<script>'+domain+'\n'+app+'</script>')
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(accept_downloads=True,viewport={'width':1600,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.evaluate("""() => Object.defineProperty(window, 'localStorage', {configurable: true, value: {
        values: {}, getItem(key){return this.values[key] ?? null}, setItem(key, value){this.values[key]=value}
    }})""")
    page.set_content(html,wait_until='load')
    assert page.locator('.day-card').count()==7,errors
    assert page.locator('[data-recipe]').count()==50,errors
    page.screenshot(path=str(project/'preview-desktop.png'),full_page=True)
    page.locator('[data-add-meal="1"]').click()
    assert page.locator('#meal-dialog').evaluate('(dialog) => dialog.open')
    page.locator('#meal-name').fill('Collation après sport')
    page.locator('#meal-time').fill('17:30')
    page.locator('#save-meal').click()
    page.locator('[data-recipe="snack-skyr"]').click()
    assert page.locator('[data-slot*="1-extra-"]').get_by_text('Skyr, fruits & noix').count()==1
    page.locator('#btn-catalog').click()
    page.locator('#ingredient-search').fill('Riz blanc')
    page.locator('[data-edit-ingredient="riz"]').click()
    page.locator('#ingredient-price').fill('2.99')
    page.locator('#save-ingredient').click()
    assert '2,99' in page.locator('#ingredient-catalog').inner_text()
    page.locator('[data-close="ingredient-dialog"]').click()
    saved=json.loads(page.evaluate("localStorage.getItem('batch-and-co.v1')"))
    assert saved['schemaVersion']==3
    assert saved['priceOverrides']['riz']==2.99
    assert any(slot.get('label')=='Collation après sport' for week in saved['plans'].values() for slot in week.values())
    # Simule une réouverture sur la même origine : les données doivent être retrouvées.
    page.set_content(html,wait_until='load')
    assert page.locator('[data-slot*="1-extra-"]').get_by_text('Skyr, fruits & noix').count()==1
    page.locator('#btn-catalog').click()
    page.locator('#ingredient-search').fill('Riz blanc')
    assert '2,99' in page.locator('#ingredient-catalog').inner_text()
    page.locator('[data-close="ingredient-dialog"]').click()
    # Export complet depuis un Blob JSON.
    with page.expect_download(timeout=10000) as download_info:
        page.locator('#btn-export').click()
    file_path=project/'tests'/'session-smoke.json'
    download_info.value.save_as(file_path)
    backup=json.loads(file_path.read_text())
    assert backup['priceOverrides']['riz']==2.99
    # Import d'une ancienne sauvegarde V2.
    legacy=dict(backup)
    legacy['schemaVersion']=2
    legacy.pop('priceOverrides',None)
    legacy.pop('deletedSeedRecipeIds',None)
    file_path.write_text(json.dumps(legacy))
    page.on('dialog',lambda dialog:dialog.accept())
    page.locator('#file-import').set_input_files(file_path)
    assert 'Session importée' in page.locator('#toast').inner_text()
    assert page.locator('.day-card').count()==7
    file_path.unlink()

    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(project/'preview-mobile.png'),full_page=True)
    assert page.locator('.day-card').count()==7
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 4'), 'débordement horizontal mobile'
    assert not errors,errors
    print('UI PASS: 7 jours, 50 recettes, collation, édition prix, persistance, export JSON, import V2, mobile, aucune erreur JS.')
    browser.close()
