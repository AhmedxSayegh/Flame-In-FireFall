"""Exercise the actual built frontend with saved real research results; never generate.

POST /api/search is intercepted before it can reach the backend. Edge-case
responses are in-memory variants for UI testing, not changes to research data.
"""
import copy
import os
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/investigation-scope'
OUT.mkdir(parents=True, exist_ok=True)
SAVED = json.loads((ROOT / 'docs/workspace-fixture.json').read_text())
URL = os.environ.get('VERIFY_URL', 'http://127.0.0.1:5000')

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1080})
    page.set_default_timeout(15000)
    errors, calls, requests, bad_responses = [], [], [], []
    console_errors, failed_requests = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: console_errors.append(m.text) if m.type=='error' else None)
    page.on('requestfailed', lambda r: failed_requests.append({'url':r.url,'failure':r.failure}))
    page.on('request', lambda r: requests.append((r.method, r.url)))
    page.on('response', lambda r: bad_responses.append([r.status, r.url]) if r.status >= 400 else None)
    payload = copy.deepcopy(SAVED)

    def replay(route):
        calls.append(route.request.post_data_json)
        route.fulfill(json=payload)

    page.route('**/api/search', replay)
    # Deliberately seed a legacy session before React initializes.
    page.add_init_script("sessionStorage.setItem('fif.form.v1', JSON.stringify({research_question:'LEGACY HIDDEN QUESTION'}))")
    page.goto(URL, wait_until='networkidle')
    assert page.locator('#rq,textarea').count() == 0
    assert page.locator('.experiment-scene,#workspace-Animation').count() == 0
    assert 'Research Question' not in page.locator('body').inner_text()
    page.wait_for_function("JSON.parse(sessionStorage.getItem('fif.form.v1')).research_question === ''")
    page.screenshot(path=str(OUT / 'search-desktop.png'), full_page=True)
    page.get_by_role('button', name='Apply Filters', exact=True).click()
    expect(page.get_by_role('heading', name='Research Results', exact=True)).to_be_visible()
    assert calls[0]['research_question'] is None
    assert 'LEGACY HIDDEN QUESTION' not in page.locator('body').inner_text()
    tabs = page.get_by_role('tablist', name='Results workspace')
    assert tabs.get_by_role('tab').all_text_contents()==['Experiment','Comparison','Evidence']
    assert not tabs.evaluate('(e)=>!!e.closest("#analysis")')
    assert page.get_by_role('tab',name='Animation',exact=True).count()==0

    def tab(name):
        tabs.get_by_role('tab', name=name, exact=True).click()

    def choose(psi):
        page.get_by_role('group', name='Select investigation', exact=True).get_by_role('button', name=re.compile(psi)).click()

    def experiment_picker(workspace='Experiment'):
        return page.locator('#workspace-' + workspace).get_by_role('combobox', name='Selected experiment', exact=True)

    def check_scope(psi, expected):
        # Include hidden controls: all selectors must share the same scope.
        for selector in page.locator('select[aria-label="Selected experiment"],select[aria-label^="Experiment "]').all():
            options = selector.locator('option').evaluate_all('(els)=>els.map(e=>e.value).filter(Boolean)')
            assert set(options) == set(expected), (psi, options, expected)
            assert not selector.input_value() or selector.input_value() in expected
        for control in page.locator('#comparison select[aria-label^="Experiment "]').all():
            assert not control.input_value() or control.input_value() in expected
        assert page.locator('#selected-evidence').inner_text().find(psi) >= 0

    assert page.get_by_role('group', name='Select investigation', exact=True).count() == 0
    by_inv = {inv['psi_id']: [e['experiment_id'] for e in sorted(inv['top_experiments'], key=lambda e:e['rank'])] for inv in SAVED['output']['ranked']}
    assert {'PSI-25', 'PSI-69'} <= set(by_inv)
    first = experiment_picker()
    check_scope('PSI-25', by_inv['PSI-25'])
    first.select_option('PSI-25-CS07')
    page.get_by_role('button', name=re.compile('^Oxygen concentration:')).click()
    expect(page.get_by_role('region', name='Measurement source inspection')).to_be_visible()
    tab('Comparison')
    strip = page.get_by_role('group', name='Select investigation', exact=True)
    assert strip.locator('button').count() == len(SAVED['output']['ranked'])
    flex_button = strip.get_by_role('button', name=re.compile('PSI-69'))
    flex_button.focus()
    expect(flex_button).to_be_focused()
    flex_button.press('Enter')
    choose('PSI-69')
    check_scope('PSI-69', by_inv['PSI-69'])
    expect(tabs.get_by_role('tab', name='Comparison', exact=True)).to_have_attribute('aria-selected', 'true')
    assert page.get_by_role('region', name='Measurement source inspection').count() == 0
    slots = page.locator('#comparison select[aria-label^="Experiment "]')
    assert slots.count() == 3
    values = [slot.input_value() for slot in slots.all()]
    assert len(set(values)) == len(values)
    # Duplicate prevention is available to keyboard and pointer users alike.
    assert slots.nth(1).locator(f'option[value="{values[0]}"]').is_disabled()
    slots.nth(2).select_option('')
    assert slots.nth(2).input_value() == ''
    slots.nth(0).select_option(values[2])
    assert slots.nth(0).input_value() == values[2]
    chart = page.get_by_role('combobox', name='Chart type', exact=True)
    chart.select_option('outcomes')
    expected_slots = [slot.input_value() for slot in slots.all()]
    table_headers = page.locator('#comparison > div table thead').first.inner_text()
    assert 'PSI-25' not in table_headers and all(x in table_headers for x in expected_slots if x)
    for title in ['Similarities', 'Differences']:
        section = page.locator('#comparison').get_by_role('heading', name=re.compile('^'+title)).locator('xpath=ancestor::section[1]')
        assert section.locator('button,summary').count() == 0
    assert page.get_by_role('heading', name='Comparison Conclusion', exact=True).evaluate('(e)=>e.parentElement.parentElement.nextElementSibling.id') == 'charts'
    page.wait_for_timeout(250)  # Allow the existing tab indicator transition to settle.
    page.screenshot(path=str(OUT / 'comparison-flex-desktop.png'), full_page=True)
    tab('Evidence')
    check_scope('PSI-69', by_inv['PSI-69'])
    evidence_picker = experiment_picker('Evidence')
    evidence_picker.select_option('PSI-69-CS55')
    expect(page.locator('#selected-evidence')).to_contain_text('PSI-69-CS55')
    expect(page.locator('#sources ol')).not_to_contain_text('PSI-25')
    expect(page.locator('#gaps')).to_contain_text('Search-wide')
    page.wait_for_timeout(250)
    page.screenshot(path=str(OUT / 'evidence-flex-desktop.png'), full_page=True)
    tab('Experiment')
    expect(first).to_have_value('PSI-69-CS55')
    assert page.get_by_role('group', name='Select investigation', exact=True).count() == 0
    tab('Comparison')
    assert [slot.input_value() for slot in slots.all()] == expected_slots
    expect(chart).to_have_value('outcomes')
    tab('Evidence')
    choose('PSI-25')
    check_scope('PSI-25', by_inv['PSI-25'])
    expect(page.locator('#sources ol')).not_to_contain_text('PSI-69')
    expect(tabs.get_by_role('tab', name='Evidence', exact=True)).to_have_attribute('aria-selected', 'true')
    tab('Comparison')
    expect(page.locator('#charts')).not_to_contain_text('PSI-69')
    page.get_by_role('combobox', name='Chart type', exact=True).select_option('outcomes')
    assert page.locator('#charts .recharts-wrapper').count() > 0
    tab('Evidence')
    tab('Experiment')
    # The original ranking changes the very same shared investigation.
    page.locator('#ranking article').filter(has_text='PSI-69').locator('button').first.click()
    check_scope('PSI-69', by_inv['PSI-69'])
    first.select_option('PSI-69-CS55')
    # Existing chart/data/CSV paths remain reachable with scoped records.
    frame = page.locator('#analysis figure')
    button = frame.get_by_role('button', name=re.compile('^Burning rate')).first
    if button.count(): button.click()
    frame.get_by_role('button', name='Data', exact=True).click()
    assert frame.locator('tbody tr').count() > 0
    with page.expect_download() as download:
        frame.get_by_role('button', name='CSV', exact=True).click()
    assert Path(download.value.path()).stat().st_size > 0
    frame.get_by_role('button', name='Chart', exact=True).click()
    tab('Comparison')
    chart.select_option('o2-burn')
    assert page.locator('#charts .recharts-wrapper').count() > 0
    chart.select_option('flow-spread')
    expect(page.locator('#charts')).to_contain_text('No flame spread rate measurements in the selected experiments')
    for workspace in ['Comparison','Evidence','Experiment']:
        tab(workspace)
        page.set_viewport_size({'width':390,'height':900})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), workspace
        page.wait_for_timeout(250)
        page.screenshot(path=str(OUT / (workspace.lower()+'-mobile.png')), full_page=True)
    page.set_viewport_size({'width':320,'height':900})
    tab('Evidence')
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    # One replayed submit only; no record fetch or extra search on any local change.
    assert len(calls) == 1
    assert len([r for r in requests if '/api/search' in r[1]]) == 1
    assert not [r for r in requests if '/api/records' in r[1]]

    # Controlled edge cases, retaining actual schema validation in the application.
    page.set_viewport_size({'width':1440,'height':1080})
    for count in [1, 0]:
        payload = copy.deepcopy(SAVED)
        payload['output']['ranked'][0]['top_experiments'] = payload['output']['ranked'][0]['top_experiments'][:count]
        page.get_by_role('button', name='Back to Filters', exact=True).click()
        page.get_by_role('button', name='Apply Filters', exact=True).click()
        expect(page.get_by_role('heading', name='Research Results', exact=True)).to_be_visible()
        tab('Comparison')
        expect(page.locator('#comparison')).to_contain_text('Two distinct experiments are required')
        selected = [e.input_value() for e in page.locator('#comparison select[aria-label^="Experiment "]').all() if e.input_value()]
        assert len(selected) == count and all(id.startswith('PSI-25') for id in selected)
        tab('Evidence')
        if count == 0:
            expect(page.locator('#selected-evidence')).to_contain_text('No experiment selected')
            expect(page.locator('#sources')).to_contain_text(SAVED['output']['ranked'][0]['name']+' investigation record')
        choose('PSI-69')
        check_scope('PSI-69', by_inv['PSI-69'])
    payload = copy.deepcopy(SAVED)
    payload['output']['ranked'] = []
    page.get_by_role('button', name='Back to Filters', exact=True).click()
    page.get_by_role('button', name='Apply Filters', exact=True).click()
    expect(page.get_by_role('heading', name='Research Results', exact=True)).to_be_visible()
    tab('Comparison')
    expect(page.locator('#comparison')).to_contain_text('No experiments available')
    tab('Evidence')
    expect(page.locator('#sources')).to_contain_text('No sources available')
    assert not errors, errors
    assert not bad_responses, bad_responses
    assert not console_errors, console_errors
    assert not failed_requests, failed_requests
    result = {'status':'passed', 'saved_records': by_inv, 'replayed_searches':len(calls),
              'generation_requests':0, 'local_navigation_extra_searches':0, 'browser_errors':errors,
              'http_errors':bad_responses, 'console_errors':console_errors, 'failed_requests':failed_requests, 'edge_cases':['single experiment','empty investigation','empty results'],
              'screenshots': sorted(x.name for x in OUT.glob('*.png'))}
    (OUT / 'verification.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    browser.close()
    print(json.dumps(result, indent=2))
