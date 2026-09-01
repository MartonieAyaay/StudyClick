import { extractTextFromPDF } from './pdfUtils'
import { useEffect, useState, useRef } from 'react'
import './App.css'
import { getAllReviewers, saveReviewer, deleteReviewer } from './db'
import {
  getUsage,
  recordUsage,
  getRequestStatus,
  DAILY_REQUEST_LIMIT,
} from './usageTracker'
import { getApiKey, saveApiKey } from './apiKeyStore'

function formatTimestamp(date) {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${hh}:${mm} ${mo}/${dd}/${yy}`
}

const API_BASE = 'http://localhost:3001'

function apiFetch(path, options = {}, apiKey) {
  const headers = { ...(options.headers || {}) }
  if (apiKey) headers['x-gemini-api-key'] = apiKey
  return fetch(`${API_BASE}${path}`, { ...options, headers })
}

function buildReviewerHTML(reviewer, accentColor) {
  const accent = accentColor || '#7091b8'
  const titleText = (reviewer.title || 'Reviewer').replace(/</g, '<')
  const reviewerJson = JSON.stringify(reviewer).replace(/</g, '\\u003c')

  const css = `
  :root { --accent: ${accent}; --sans: 'Segoe UI', system-ui, -apple-system, sans-serif; --heading: Georgia, 'Times New Roman', serif; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--sans); }
  .btn-primary {
    background: var(--accent, #40566F); color: #fff; border: none; padding: 10px 24px;
    border-radius: 20px; font-family: var(--sans); font-size: 14px; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .btn-primary:hover { filter: brightness(0.9); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; filter: none; }
  .btn-secondary {
    padding: 8px 16px; border-radius: 8px; border: 1px solid #a9b8c7; background: transparent;
    cursor: pointer; font-family: var(--sans);
  }
  .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
  .viewer-page {
    min-height: 100vh; display: flex; flex-direction: column; align-items: stretch;
    background: var(--viewer-page-bg); padding: 32px 48px; box-sizing: border-box;
    --viewer-page-bg: color-mix(in srgb, var(--accent) 8%, white);
    --viewer-card-bg: #ffffff;
    --viewer-card-border: var(--accent);
    --viewer-text: #2d2130;
    --viewer-tab-inactive-bg: color-mix(in srgb, var(--accent) 22%, white);
    --viewer-tab-inactive-text: color-mix(in srgb, var(--accent) 65%, black);
  }
  .viewer-page.dark-theme {
    --viewer-page-bg: #241a2e;
    --viewer-card-bg: color-mix(in srgb, var(--accent) 25%, #241a2e);
    --viewer-card-border: transparent;
    --viewer-text: #f5eef8;
    --viewer-tab-inactive-bg: color-mix(in srgb, var(--accent) 35%, #241a2e);
    --viewer-tab-inactive-text: #e8dcef;
  }
  .viewer-topbar { display: flex; align-items: center; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
  .viewer-page-title {
    display: flex; align-items: center; gap: 10px; font-family: var(--heading); font-size: 30px;
    font-weight: 700; color: var(--viewer-text); margin: 0; white-space: nowrap;
  }
  .viewer-search { position: relative; flex: 1; min-width: 240px; max-width: 560px; }
  .viewer-search input {
    width: 100%; padding: 10px 40px 10px 14px; border-radius: 20px; border: 1px solid #000;
    font-family: var(--sans); font-size: 13px; box-sizing: border-box;
  }
  .viewer-search-icon { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--viewer-text); }
  .viewer-topbar-actions { display: flex; align-items: center; gap: 12px; }
  .font-btn, .theme-btn {
    background: transparent; border: none; padding: 10px 22px; font-family: var(--sans);
    font-size: 14px; font-weight: 600; cursor: pointer; color: inherit;
  }
  .theme-btn { border: 1px solid #000; border-radius: 20px; background: #fff; }
  .font-btn:hover, .theme-btn:hover { background: #f4f4f4; }
  .font-size-control { display: flex; align-items: stretch; border: 1px solid #000; border-radius: 20px; overflow: hidden; background: #fff; }
  .font-btn-divider { width: 1px; background: #000; }
  .viewer-page.dark-theme .viewer-search input,
  .viewer-page.dark-theme .font-size-control,
  .viewer-page.dark-theme .theme-btn { background: transparent; border-color: var(--viewer-text); color: var(--viewer-text); }
  .viewer-page.dark-theme .font-btn-divider { background: var(--viewer-text); }
  .viewer-page.dark-theme .viewer-search input::placeholder { color: color-mix(in srgb, var(--viewer-text) 60%, transparent); }
  .viewer-tabs { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
  .viewer-tab {
    background: var(--viewer-tab-inactive-bg); color: var(--viewer-tab-inactive-text); border: none;
    border-radius: 999px; padding: 8px 20px; font-family: var(--sans); font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .viewer-tab.active { background: var(--accent); color: #fff; }
  .viewer-tab.dimmed { opacity: 0.4; }
  .viewer-content { width: 100%; max-width: 900px; margin: 0 auto; }
  .module-content { display: flex; flex-direction: column; gap: 28px; }
  #viewer-content > [hidden] { display: none; }
  .module-title { font-family: var(--heading); font-size: 20px; color: var(--viewer-text); margin: 0 0 16px; }
  mark { background: color-mix(in srgb, var(--accent) 40%, yellow); color: inherit; padding: 0 2px; border-radius: 2px; }
  .collapsible-card { background: var(--viewer-card-bg); border: 1.5px solid var(--viewer-card-border); border-radius: 12px; overflow: hidden; color: var(--viewer-text); }
  .collapsible-header {
    width: 100%; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
    padding: 16px 20px; background: none; border: none; cursor: pointer; text-align: left;
    font-family: var(--sans); color: var(--viewer-text);
  }
  .collapsible-header-content { flex: 1; min-width: 0; }
  .collapsible-header-content h3 { font-family: var(--heading); font-size: 16px; margin: 0; color: var(--viewer-text); }
  .collapsible-header .chev { flex-shrink: 0; color: var(--viewer-text); transition: transform 0.2s ease; font-size: 1.1rem; margin-top: 2px; }
  .collapsible-card.open .chev { transform: rotate(90deg); }
  .collapsible-body { padding: 0 20px 20px; }
  .key-vital, .key-glossary, .key-start-here { margin-bottom: 14px; }
  .key-vital h4, .key-glossary h4, .key-start-here h4 {
    margin: 4px 0 8px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: color-mix(in srgb, var(--viewer-text) 65%, transparent);
  }
  .key-vital ul { margin: 0; padding-left: 20px; }
  .key-vital li { margin-bottom: 8px; line-height: 1.45; font-size: 14px; }
  .glossary-item { padding: 8px 0; border-top: 1px dashed var(--viewer-card-border); }
  .glossary-item:first-child { border-top: none; }
  .glossary-term { font-weight: 700; font-size: 14px; }
  .glossary-def { color: color-mix(in srgb, var(--viewer-text) 80%, transparent); font-size: 14px; margin-top: 2px; }
  .concept-def {
    background: color-mix(in srgb, var(--accent) 6%, transparent); border-left: 3px solid var(--accent);
    padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 14px; line-height: 1.55;
  }
  .concept-def .def-list { margin: 0; padding-left: 20px; list-style: disc; }
  .concept-def .def-list li { margin-bottom: 9px; }
  .concept-def strong { color: var(--accent); }
  .formula-box { background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: 8px; padding: 10px 14px; margin: 10px 0; font-size: 0.98rem; text-align: center; color: var(--viewer-text); overflow-x: auto; }
  .examples-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: color-mix(in srgb, var(--viewer-text) 65%, transparent); margin: 16px 0 8px; font-weight: 700; }
  .example-block { border: 1px solid var(--viewer-card-border); border-radius: 10px; margin-bottom: 12px; background: color-mix(in srgb, var(--accent) 4%, transparent); overflow: hidden; }
  .example-head { padding: 10px 14px; font-weight: 700; font-size: 0.88rem; color: var(--viewer-text); }
  .example-problem { padding: 0 14px 10px; font-size: 14px; color: color-mix(in srgb, var(--viewer-text) 85%, transparent); line-height: 1.5; }
  .example-toggle {
    margin: 0 14px 12px; border: 1px solid var(--accent); color: var(--accent); background: transparent;
    padding: 6px 12px; border-radius: 999px; font-size: 0.8rem; cursor: pointer; font-family: var(--sans); font-weight: 600;
  }
  .example-solution { padding: 0 14px 14px; }
  .sol-step { padding: 8px 0; border-top: 1px solid var(--viewer-card-border); font-size: 0.9rem; line-height: 1.5; }
  .sol-step:first-child { border-top: none; }
  .sol-step .step-label { font-weight: 700; color: var(--accent); margin-right: 4px; }
  .sol-answer { margin-top: 8px; background: color-mix(in srgb, #34a853 15%, transparent); border: 1px solid #34a853; border-radius: 8px; padding: 9px 13px; font-weight: 700; font-size: 0.92rem; color: var(--viewer-text); }
  .collapsible-body > p { font-size: 14px; line-height: 1.55; margin: 0; color: var(--viewer-text); }
  .quiz-section { background: var(--viewer-card-bg); border: 1.5px solid var(--viewer-card-border); border-radius: 12px; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; color: var(--viewer-text); }
  .quiz-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .quiz-row h3 { font-family: var(--heading); font-size: 16px; margin: 0; color: var(--viewer-text); }
  .quiz-nav { display: flex; gap: 8px; flex-shrink: 0; }
  .quiz-options { display: flex; flex-direction: column; gap: 10px; }
  .quiz-option { display: flex; align-items: center; gap: 10px; font-size: 13px; cursor: pointer; color: var(--viewer-text); }
  .quiz-option.selected { font-weight: 600; }
  .quiz-option input[type='radio'] { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
  .quiz-hint { font-size: 12px; color: #b0413e; margin: 0; }
  .quiz-review { display: flex; flex-direction: column; gap: 12px; }
  .quiz-review-item { padding: 12px; border-radius: 8px; border: 1px solid var(--viewer-card-border); }
  .quiz-review-item.correct { border-color: #4a8f5c; background: color-mix(in srgb, #4a8f5c 12%, transparent); }
  .quiz-review-item.incorrect { border-color: #b0413e; background: color-mix(in srgb, #b0413e 12%, transparent); }
  .quiz-review-question { font-weight: 600; margin: 0 0 4px; font-size: 13px; }
  .quiz-review-answer { font-size: 13px; margin: 0; }
  .quiz-review-correct { font-size: 13px; margin: 4px 0 0; color: #4a8f5c; }
  `

  const script = `
(function() {
  var REVIEWER = window.__REVIEWER_DATA__;
  var collapsibleEnabled = REVIEWER.collapsible !== false;
  var state = { activeTab: 0, query: '' };
  var fontScale = 1;
  var quizState = { state: 'intro', index: 0, answers: {} };

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escapeRegExp(str) { return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); }
  function highlightText(text, query) {
    var escaped = escapeHtml(text);
    if (!query) return escaped;
    var re = new RegExp('(' + escapeRegExp(escapeHtml(query)) + ')', 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
  }
  function stripHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return tmp.textContent || '';
  }
  function moduleHaystack(m) {
    var parts = [];
    if (m.summary) parts.push(m.summary);
    ((m.keyConcepts && m.keyConcepts.vital) || []).forEach(function(v){ parts.push(v.idea, v.why); });
    ((m.keyConcepts && m.keyConcepts.glossary) || []).forEach(function(g){ parts.push(g.term, g.def); });
    (m.concepts || []).forEach(function(c){ parts.push(c.title, c.classification, stripHtml(c.definition || '')); });
    return parts.filter(Boolean).join(' ').toLowerCase();
  }
  function moduleHasMatch(m, query) {
    if (!query) return true;
    return moduleHaystack(m).indexOf(query) !== -1;
  }

  function examplesHtml(examples) {
    if (!examples || !examples.length) return '';
    var html = '<div class="examples-label">Worked Examples</div>';
    examples.forEach(function(ex, i) {
      html += '<div class="example-block">' +
        '<div class="example-head">Example ' + (i+1) + (ex.tag ? ' — ' + escapeHtml(ex.tag) : '') + '</div>' +
        '<div class="example-problem">' + escapeHtml(ex.problem) + '</div>' +
        '<button type="button" class="example-toggle">Show step-by-step solution</button>' +
        '<div class="example-solution" hidden>' +
          (ex.steps || []).map(function(step, si){ return '<div class="sol-step"><span class="step-label">Step ' + (si+1) + ':</span> ' + escapeHtml(step) + '</div>'; }).join('') +
          '<div class="sol-answer">Final Answer: ' + escapeHtml(ex.answer) + '</div>' +
        '</div>' +
      '</div>';
    });
    return html;
  }

  function collapsibleCardHtml(headerHtml, bodyHtml, openByDefault) {
    var open = !collapsibleEnabled || openByDefault;
    var chev = collapsibleEnabled ? '<span class="chev">▸</span>' : '';
    return '<div class="collapsible-card' + (open ? ' open' : '') + '">' +
      '<button type="button" class="collapsible-header"' + (collapsibleEnabled ? '' : ' style="cursor:default"') + '>' +
        '<div class="collapsible-header-content">' + headerHtml + '</div>' + chev +
      '</button>' +
      '<div class="collapsible-body"' + (open ? '' : ' style="display:none"') + '>' + bodyHtml + '</div>' +
    '</div>';
  }

  function moduleContentHtml(m, moduleIdx) {
    var startHere = m.concepts && m.concepts.length > 0 ? m.concepts[0] : null;
    var rest = m.concepts && m.concepts.length > 1 ? m.concepts.slice(1) : [];
    var html = '';

    if (m.summary) {
      var summaryBody = '<p data-search="summary" data-module="' + moduleIdx + '">' + highlightText(m.summary, '') + '</p>';
      html += collapsibleCardHtml('<h3>Lesson Summary</h3>', summaryBody, true);
    }

    if (m.keyConcepts || startHere) {
      var body = '';
      if (m.keyConcepts && m.keyConcepts.vital && m.keyConcepts.vital.length) {
        body += '<div class="key-vital"><h4>Vital Few Ideas</h4><ul>';
        m.keyConcepts.vital.forEach(function(v, vi) {
          body += '<li data-search="vital" data-module="' + moduleIdx + '" data-idx="' + vi + '"><strong>' + highlightText(v.idea, '') + '</strong> — <span class="vital-why">' + highlightText(v.why, '') + '</span></li>';
        });
        body += '</ul></div>';
      }
      if (m.keyConcepts && m.keyConcepts.glossary && m.keyConcepts.glossary.length) {
        body += '<div class="key-glossary"><h4>Plain-English Glossary</h4>';
        m.keyConcepts.glossary.forEach(function(g, gi) {
          body += '<div class="glossary-item"><div class="glossary-term" data-search="glossary-term" data-module="' + moduleIdx + '" data-idx="' + gi + '">' + highlightText(g.term, '') + '</div><div class="glossary-def" data-search="glossary-def" data-module="' + moduleIdx + '" data-idx="' + gi + '">' + highlightText(g.def, '') + '</div></div>';
        });
        body += '</div>';
      }
      if (startHere) {
        body += '<div class="key-start-here"><h4>Basic Vocabulary</h4><div class="concept-def">' + (startHere.definition || '') + '</div>' +
          (startHere.formula ? '<div class="formula-box">' + startHere.formula + '</div>' : '') +
          examplesHtml(startHere.examples) + '</div>';
      }
      html += collapsibleCardHtml('<h3>Key Concepts &amp; Terms</h3>', body, false);
    }

    rest.forEach(function(c) {
      var body = '<div class="concept-def">' + (c.definition || '') + '</div>' +
        (c.formula ? '<div class="formula-box">' + c.formula + '</div>' : '') +
        examplesHtml(c.examples);
      html += collapsibleCardHtml('<h3>' + escapeHtml(c.title) + '</h3>', body, false);
    });

    return html;
  }

  var modulePanelsHtml = (REVIEWER.modules || []).map(function(m, i) {
    return '<div class="module-content" data-tab="' + i + '"' + (i === 0 ? '' : ' hidden') + '>' +
      '<h3 class="module-title">' + escapeHtml(m.title) + '</h3>' +
      moduleContentHtml(m, i) +
    '</div>';
  }).join('');

  var hasQuiz = REVIEWER.finalTest && REVIEWER.finalTest.length > 0;
  var quizPanelHtml = hasQuiz ?
    '<div class="module-content" data-tab="final-test" hidden>' +
      '<h3 class="module-title">Final Test</h3>' +
      '<div id="quiz-root"></div>' +
    '</div>' : '';

  document.getElementById('viewer-content').innerHTML = modulePanelsHtml + quizPanelHtml;

  var tabsHtml = (REVIEWER.modules || []).map(function(m, i) {
    return '<button type="button" class="viewer-tab' + (i === 0 ? ' active' : '') + '" data-tab="' + i + '">' + escapeHtml(m.title) + '</button>';
  }).join('') + (hasQuiz ? '<button type="button" class="viewer-tab" data-tab="final-test">Final Test</button>' : '');
  document.getElementById('viewer-tabs').innerHTML = tabsHtml;

  function setActiveTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.viewer-tab').forEach(function(btn) {
      btn.classList.toggle('active', String(btn.getAttribute('data-tab')) === String(tab));
    });
    document.querySelectorAll('#viewer-content > [data-tab]').forEach(function(panel) {
      panel.hidden = String(panel.getAttribute('data-tab')) !== String(tab);
    });
    if (tab === 'final-test') renderQuiz();
  }

  document.getElementById('viewer-tabs').addEventListener('click', function(e) {
    var btn = e.target.closest('.viewer-tab');
    if (!btn) return;
    var tab = btn.getAttribute('data-tab');
    setActiveTab(tab === 'final-test' ? 'final-test' : Number(tab));
  });

  document.getElementById('viewer-content').addEventListener('click', function(e) {
    var toggleBtn = e.target.closest('.example-toggle');
    if (toggleBtn) {
      var sol = toggleBtn.nextElementSibling;
      var isHidden = sol.hasAttribute('hidden');
      if (isHidden) { sol.removeAttribute('hidden'); toggleBtn.textContent = 'Hide step-by-step solution'; }
      else { sol.setAttribute('hidden', ''); toggleBtn.textContent = 'Show step-by-step solution'; }
      return;
    }
    var header = e.target.closest('.collapsible-header');
    if (header && collapsibleEnabled) {
      var card = header.closest('.collapsible-card');
      var body = header.nextElementSibling;
      var isOpen = card.classList.contains('open');
      card.classList.toggle('open', !isOpen);
      body.style.display = isOpen ? 'none' : '';
    }
  });

  var searchInput = document.getElementById('viewer-search-input');
  searchInput.addEventListener('input', function() {
    state.query = searchInput.value.trim().toLowerCase();
    applySearch();
  });

  function applySearch() {
    var q = state.query;
    (REVIEWER.modules || []).forEach(function(m, mi) {
      var summaryEl = document.querySelector('[data-search="summary"][data-module="' + mi + '"]');
      if (summaryEl) summaryEl.innerHTML = highlightText(m.summary, q);
      ((m.keyConcepts && m.keyConcepts.vital) || []).forEach(function(v, vi) {
        var li = document.querySelector('[data-search="vital"][data-module="' + mi + '"][data-idx="' + vi + '"]');
        if (li) li.innerHTML = '<strong>' + highlightText(v.idea, q) + '</strong> — <span class="vital-why">' + highlightText(v.why, q) + '</span>';
      });
      ((m.keyConcepts && m.keyConcepts.glossary) || []).forEach(function(g, gi) {
        var termEl = document.querySelector('[data-search="glossary-term"][data-module="' + mi + '"][data-idx="' + gi + '"]');
        var defEl = document.querySelector('[data-search="glossary-def"][data-module="' + mi + '"][data-idx="' + gi + '"]');
        if (termEl) termEl.innerHTML = highlightText(g.term, q);
        if (defEl) defEl.innerHTML = highlightText(g.def, q);
      });
    });

    document.querySelectorAll('.viewer-tab').forEach(function(btn) {
      var tab = btn.getAttribute('data-tab');
      if (tab === 'final-test') { btn.classList.remove('dimmed'); return; }
      var m = REVIEWER.modules[Number(tab)];
      var match = moduleHasMatch(m, q);
      btn.classList.toggle('dimmed', !!q && !match);
    });

    if (!q) return;
    if (state.activeTab === 'final-test') return;
    var current = REVIEWER.modules[state.activeTab];
    if (current && moduleHasMatch(current, q)) return;
    var firstMatchIdx = REVIEWER.modules.findIndex(function(m) { return moduleHasMatch(m, q); });
    if (firstMatchIdx !== -1) setActiveTab(firstMatchIdx);
  }

  document.getElementById('font-dec').addEventListener('click', function() {
    fontScale = Math.max(Math.round((fontScale - 0.1) * 10) / 10, 0.8);
    document.getElementById('viewer-content').style.zoom = fontScale;
  });
  document.getElementById('font-inc').addEventListener('click', function() {
    fontScale = Math.min(Math.round((fontScale + 0.1) * 10) / 10, 1.4);
    document.getElementById('viewer-content').style.zoom = fontScale;
  });

  document.getElementById('theme-toggle').addEventListener('click', function() {
    var page = document.getElementById('viewer-page-root');
    var isDark = page.classList.toggle('dark-theme');
    document.getElementById('theme-toggle').textContent = isDark ? 'Dark' : 'Light';
  });

  function renderQuiz() {
    var root = document.getElementById('quiz-root');
    if (!root) return;
    var quiz = REVIEWER.finalTest;
    var q = quizState;

    if (q.state === 'intro') {
      root.innerHTML = '<div class="quiz-section"><div class="quiz-row"><h3>Ready to start the Quiz?</h3><button type="button" class="btn-primary" id="quiz-start">Start</button></div></div>';
      document.getElementById('quiz-start').addEventListener('click', function() {
        q.state = 'active'; q.index = 0; q.answers = {};
        renderQuiz();
      });
      return;
    }

    if (q.state === 'active') {
      var current = quiz[q.index];
      var allAnswered = quiz.every(function(_, i) { return q.answers[i] !== undefined; });
      var options = current.options && current.options.length ? current.options : ['True', 'False'];
      var optionsHtml = options.map(function(opt) {
        var selected = q.answers[q.index] === opt;
        return '<label class="quiz-option' + (selected ? ' selected' : '') + '"><input type="radio" name="quiz-q" ' + (selected ? 'checked' : '') + ' data-option="' + escapeHtml(opt) + '" /> ' + escapeHtml(opt) + '</label>';
      }).join('');
      var isLast = q.index === quiz.length - 1;
      var navHtml = '<div class="quiz-nav">' +
        '<button type="button" class="btn-secondary" id="quiz-back" ' + (q.index === 0 ? 'disabled' : '') + '>Back</button>' +
        (isLast
          ? '<button type="button" class="btn-primary" id="quiz-submit" ' + (allAnswered ? '' : 'disabled') + '>Submit</button>'
          : '<button type="button" class="btn-secondary" id="quiz-next">Next</button>') +
        '</div>';
      root.innerHTML = '<div class="quiz-section">' +
        '<div class="quiz-row"><h3>' + (q.index + 1) + '. ' + escapeHtml(current.question) + '</h3>' + navHtml + '</div>' +
        '<div class="quiz-options">' + optionsHtml + '</div>' +
        (!allAnswered && isLast ? '<p class="quiz-hint">Answer all questions before submitting.</p>' : '') +
      '</div>';

      root.querySelectorAll('.quiz-option input').forEach(function(input) {
        input.addEventListener('change', function() {
          q.answers[q.index] = input.getAttribute('data-option');
          renderQuiz();
        });
      });
      var backBtn = document.getElementById('quiz-back');
      if (backBtn) backBtn.addEventListener('click', function() { if (q.index > 0) { q.index--; renderQuiz(); } });
      var nextBtn = document.getElementById('quiz-next');
      if (nextBtn) nextBtn.addEventListener('click', function() { if (q.index < quiz.length - 1) { q.index++; renderQuiz(); } });
      var submitBtn = document.getElementById('quiz-submit');
      if (submitBtn) submitBtn.addEventListener('click', function() { q.state = 'finished'; renderQuiz(); });
      return;
    }

    if (q.state === 'finished') {
      var score = quiz.reduce(function(total, question, i) { return q.answers[i] === question.correctAnswer ? total + 1 : total; }, 0);
      var reviewHtml = quiz.map(function(question, i) {
        var correct = q.answers[i] === question.correctAnswer;
        return '<div class="quiz-review-item ' + (correct ? 'correct' : 'incorrect') + '">' +
          '<p class="quiz-review-question">' + (i+1) + '. ' + escapeHtml(question.question) + '</p>' +
          '<p class="quiz-review-answer">Your answer: ' + escapeHtml(q.answers[i]) + '</p>' +
          (!correct ? '<p class="quiz-review-correct">Correct answer: ' + escapeHtml(question.correctAnswer) + '</p>' : '') +
        '</div>';
      }).join('');
      root.innerHTML = '<div class="quiz-section">' +
        '<div class="quiz-row"><h3>You scored ' + score + ' / ' + quiz.length + '</h3><button type="button" class="btn-primary" id="quiz-retake">Retake Quiz</button></div>' +
        '<div class="quiz-review">' + reviewHtml + '</div>' +
      '</div>';
      document.getElementById('quiz-retake').addEventListener('click', function() {
        q.state = 'intro'; q.index = 0; q.answers = {};
        renderQuiz();
      });
    }
  }

  setActiveTab(0);
})();
`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${titleText}</title>
<style>${css}</style>
</head>
<body>
  <div class="viewer-page" id="viewer-page-root">
    <div class="viewer-topbar">
      <h2 class="viewer-page-title">${titleText}</h2>
      <div class="viewer-search">
        <input type="text" id="viewer-search-input" placeholder="Search all modules..." />
        <svg class="viewer-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <div class="viewer-topbar-actions">
        <div class="font-size-control">
          <button type="button" class="font-btn" id="font-dec">A-</button>
          <span class="font-btn-divider"></span>
          <button type="button" class="font-btn" id="font-inc">A+</button>
        </div>
        <button type="button" class="theme-btn" id="theme-toggle">Light</button>
      </div>
    </div>
    <div class="viewer-tabs" id="viewer-tabs"></div>
    <div class="viewer-content" id="viewer-content"></div>
  </div>
  <script>window.__REVIEWER_DATA__ = ${reviewerJson};</script>
  <script>${script}</script>
</body>
</html>`
}

function App() {
  const [view, setView] = useState('landing')
  const [page, setPage] = useState('upload-title')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [sourceFiles, setSourceFiles] = useState([])
  const [reviewers, setReviewers] = useState([])
  const [generationError, setGenerationError] = useState(null)
  const [selectedReviewer, setSelectedReviewer] = useState(null)
  const [accentColor, setAccentColor] = useState('#7091b8')
  const [descriptionStyle, setDescriptionStyle] = useState('verbatim')
  const [quizTypes, setQuizTypes] = useState({ multipleChoice: false, trueFalse: true })
  const [collapsible, setCollapsible] = useState(true)
  const [includeFinalTest, setIncludeFinalTest] = useState(true)
  const [includeExamples, setIncludeExamples] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingMessage, setLoadingMessage] = useState('Preparing your sources...')
  const [usage, setUsage] = useState(() => getUsage())
  const [apiKey, setApiKeyState] = useState(() => getApiKey())

  function setApiKey(key) {
    setApiKeyState(key)
    saveApiKey(key)
  }
  const canConfigure = sourceFiles.length > 0 || notes.trim().length > 0

  useEffect(() => {
    if (page !== 'generating') return

    setLoadingProgress(0)
    setLoadingMessage('Preparing your sources...')
    setGenerationError(null)

    let cancelled = false
    let stopCreep = null

    // Ticks the progress bar smoothly from `floor` toward `ceiling` (never
    // reaching it) while a request is in flight, so the bar keeps moving
    // instead of freezing at one number until the response comes back.
    function creepProgress(floor, ceiling) {
      let current = floor
      const cap = ceiling - Math.min(2, (ceiling - floor) * 0.2)
      const intervalId = window.setInterval(() => {
        current = Math.min(current + (cap - current) * 0.06 + 0.1, cap)
        setLoadingProgress(current)
      }, 150)
      return () => window.clearInterval(intervalId)
    }

    async function runGeneration() {
      const sources = sourceFiles.map((s) => ({ name: s.name, text: s.text }))
      if (notes.trim()) {
        sources.push({ name: 'Pasted Notes', text: notes.trim() })
      }

      try {
        setLoadingMessage('Splitting your sources into modules...')
        setLoadingProgress(8)
        stopCreep = creepProgress(8, 20)

        const modulesRes = await apiFetch('/test-modules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sources }),
        }, apiKey)
        const modulesData = await modulesRes.json()
        stopCreep()
        if (cancelled) return
        if (!modulesRes.ok) {
          throw new Error(modulesData.error || 'Failed to determine modules')
        }
        if (modulesData.usage) setUsage(recordUsage(modulesData.usage.totalTokens, 1))
        setLoadingProgress(20)
        const modules = modulesData.modules

        const moduleSpan = includeFinalTest ? 60 : 78
        const perModuleSpan = moduleSpan / modules.length
        const generatedModules = []
        for (let i = 0; i < modules.length; i++) {
          if (cancelled) return
          const floor = 20 + i * perModuleSpan
          const ceiling = 20 + (i + 1) * perModuleSpan
          setLoadingMessage(`Generating content for "${modules[i].title}" (${i + 1}/${modules.length})...`)
          setLoadingProgress(floor)
          stopCreep = creepProgress(floor, ceiling)

          const contentRes = await apiFetch('/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: modules[i].text, descriptionStyle, includeExamples }),
          }, apiKey)
          const { usage: moduleUsage, ...content } = await contentRes.json()
          stopCreep()
          if (cancelled) return
          if (!contentRes.ok) {
            throw new Error(content.error || `Failed to generate content for "${modules[i].title}"`)
          }
          if (moduleUsage) setUsage(recordUsage(moduleUsage.totalTokens, 1))
          setLoadingProgress(ceiling)
          generatedModules.push({ title: modules[i].title, ...content })
        }

        let finalTestQuiz = null
        if (includeFinalTest) {
          setLoadingMessage('Building your Final Test...')
          stopCreep = creepProgress(80, 98)

          const finalTestRes = await apiFetch('/test-final-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modules, quizType: quizTypes }),
          }, apiKey)
          const finalTestData = await finalTestRes.json()
          stopCreep()
          if (cancelled) return
          if (!finalTestRes.ok) {
            throw new Error(finalTestData.error || 'Failed to generate the Final Test')
          }
          if (finalTestData.usage) setUsage(recordUsage(finalTestData.usage.totalTokens, 1))
          finalTestQuiz = finalTestData.quiz
        }

        setLoadingProgress(100)
        setLoadingMessage('Finalizing your reviewer...')

        window.setTimeout(() => {
          if (cancelled) return
          const newReviewer = {
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            title: title.trim() || 'Untitled Reviewer',
            created: formatTimestamp(new Date()),
            modules: generatedModules,
            finalTest: finalTestQuiz,
            collapsible,
          }
          setReviewers((prev) => [newReviewer, ...prev])
          saveReviewer(newReviewer).catch((err) => console.error('Failed to save reviewer', err))
          setTitle('')
          setNotes('')
          setSourceFiles([])
          setPage('reviewers')
        }, 300)

      } catch (err) {
        if (stopCreep) stopCreep()
        if (cancelled) return
        setGenerationError(err.message || 'Something went wrong generating your reviewer.')
      }
    }

    runGeneration()

    return () => {
      cancelled = true
      if (stopCreep) stopCreep()
    }
  }, [page])

  useEffect(() => {
    getAllReviewers()
      .then(setReviewers)
      .catch((err) => console.error('Failed to load saved reviewers', err))
  }, [])

  function goToApp() {
    setView('app')
    setPage('dashboard')
  }

  function handleFinish() {
    setPage('generating')
  }

  function handleNewReviewer() {
    setTitle('')
    setNotes('')
    setSourceFiles([])
    setPage('upload-title')
  }

  function openReviewer(reviewer) {
    setSelectedReviewer(reviewer)
    setPage('viewer')
  }

  function handleDeleteReviewer(reviewer) {
    if (!window.confirm(`Delete "${reviewer.title}"? This can't be undone.`)) return
    setReviewers((prev) => prev.filter((r) => r.id !== reviewer.id))
    deleteReviewer(reviewer.id).catch((err) => console.error('Failed to delete reviewer', err))
  }

  function handleDownloadReviewer(reviewer) {
    const html = buildReviewerHTML(reviewer, accentColor)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(reviewer.title || 'reviewer').replace(/[^a-z0-9]+/gi, '_')}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (view === 'landing') {
    return (
      <div className="landing" style={{ '--accent': accentColor }}>
        <div className="landing-card">
          <h1>StudyClick</h1>
          <p>Create reviewers with just a few clicks.</p>
          <button className="btn-primary" onClick={goToApp}>Get Started</button>
        </div>
      </div>
    )
  }

  if (page === 'viewer' && selectedReviewer) {
    return (
      <div style={{ '--accent': accentColor }}>
        <ReviewerViewer reviewer={selectedReviewer} onBack={() => setPage('reviewers')} />
      </div>
    )
  }

  return (
    <div className="app-shell" style={{ '--accent': accentColor }}>
      <Sidebar page={page} setPage={setPage} canConfigure={canConfigure} title={title} onNewReviewer={handleNewReviewer} />
      <div className="content">
        {page === 'dashboard' && (
          <Dashboard
            reviewers={reviewers}
            usage={usage}
            apiKey={apiKey}
            onNewReviewer={handleNewReviewer}
            onGoToSettings={() => setPage('settings')}
          />
        )}
        {page === 'settings' && (
          <SettingsPage apiKey={apiKey} setApiKey={setApiKey} />
        )}
        {page === 'upload-title' && (
          <UploadTitleStep title={title} setTitle={setTitle} onNext={() => setPage('upload-sources')} />
        )}
        {page === 'upload-sources' && (
          <UploadSourcesStep
            notes={notes} setNotes={setNotes}
            sourceFiles={sourceFiles} setSourceFiles={setSourceFiles}
            onNext={() => setPage('configure')}
          />
        )}
        {page === 'configure' && (
          <ConfigurePage
            title={title} setTitle={setTitle}
            accentColor={accentColor} setAccentColor={setAccentColor}
            descriptionStyle={descriptionStyle} setDescriptionStyle={setDescriptionStyle}
            quizTypes={quizTypes} setQuizTypes={setQuizTypes}
            collapsible={collapsible} setCollapsible={setCollapsible}
            includeFinalTest={includeFinalTest} setIncludeFinalTest={setIncludeFinalTest}
            includeExamples={includeExamples} setIncludeExamples={setIncludeExamples}
            onFinish={handleFinish}
          />
        )}
        {page === 'generating' && (
          <GeneratingPage progress={loadingProgress} message={loadingMessage} error={generationError} onRetry={handleFinish} />
        )}
        {page === 'reviewers' && (
          <ReviewersPage
            reviewers={reviewers}
            onSelect={openReviewer}
            onDelete={handleDeleteReviewer}
            onDownload={handleDownloadReviewer}
          />
        )}
      </div>
    </div>
  )
}

function Sidebar({ page, setPage, canConfigure, title, onNewReviewer }) {
  const isDashboard = page === 'dashboard'
  const isUpload = page === 'upload-title' || page === 'upload-sources'
  const isConfigure = page === 'configure'
  const isReviewers = page === 'reviewers' || page === 'generating' || page === 'viewer'
  const isSettings = page === 'settings'

  return (
    <div className="sidebar">
      <h2 className="sidebar-logo">StudyClick</h2>
      <nav>
        <button className={isDashboard ? 'nav-item active' : 'nav-item'} onClick={() => setPage('dashboard')}>Dashboard</button>
        <button
          className={isUpload ? 'nav-item active' : 'nav-item'}
          onClick={onNewReviewer}
        >
          Create New Reviewer
        </button>
        <button
          className={isConfigure ? 'nav-item active' : 'nav-item'}
          onClick={() => canConfigure && setPage('configure')}
          disabled={!canConfigure}
          title={!canConfigure ? 'Upload a source first' : undefined}
        >
          Configure
        </button>
        <button className={isReviewers ? 'nav-item active' : 'nav-item'} onClick={() => setPage('reviewers')}>Reviewers</button>
        <button className={isSettings ? 'nav-item active' : 'nav-item'} onClick={() => setPage('settings')}>Settings</button>
      </nav>
    </div>
  )
}

function Dashboard({ reviewers, usage, apiKey, onNewReviewer, onGoToSettings }) {
  const requestStatus = getRequestStatus(usage)

  return (
    <div className="page">
      <div className="dashboard-content">
        <div className="dashboard-header">
          <h2 className="page-title">Dashboard</h2>
          <button className="btn-primary" onClick={onNewReviewer}>Create new reviewer</button>
        </div>

        {!apiKey && (
          <div className="dashboard-banner">
            <span>No Gemini API key set yet — generation won't work until you add one.</span>
            <button className="btn-secondary" onClick={onGoToSettings}>Add key</button>
          </div>
        )}

        <div className="dashboard-cards">
          <div className="dashboard-card">
            <span>Reviewers generated</span>
            <strong>{reviewers.length}</strong>
          </div>

          <div className={`dashboard-card token-card token-${requestStatus.level}`}>
            <div className="dashboard-card-row">
              <span>Requests remaining today</span>
              <strong>{requestStatus.remaining.toLocaleString()} / {DAILY_REQUEST_LIMIT.toLocaleString()}</strong>
            </div>
            <p className="dashboard-card-note">{requestStatus.message}</p>
          </div>

          <div className="dashboard-card">
            <span>Tokens used today</span>
            <strong>{usage.tokensUsed.toLocaleString()}</strong>
          </div>
        </div>

        <p className="dashboard-disclaimer">
          Resets daily and only counts what you've generated through StudyClick. Requests are checked against
          Google's real daily limit — tokens don't have a fixed cap, so that number's just for reference.
        </p>
      </div>
    </div>
  )
}

function SettingsPage({ apiKey, setApiKey }) {
  const [draft, setDraft] = useState(apiKey)
  const [justSaved, setJustSaved] = useState(false)
  const [visible, setVisible] = useState(false)

  function handleSave() {
    setApiKey(draft.trim())
    setJustSaved(true)
    window.setTimeout(() => setJustSaved(false), 2000)
  }

  return (
    <div className="page">
      <div className="dashboard-content">
        <h2 className="page-title">Settings</h2>

        <h3 style={{ marginTop: 24 }}>Gemini API key</h3>
        <p className="hint" style={{ margin: '0 0 12px' }}>
          StudyClick calls Google's Gemini API using your own key, so it stays free to run. Get one at{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.
          It's stored only in this browser and sent straight to your own local server, never anywhere else.
        </p>

        <div className="api-key-row">
          <input
            type={visible ? 'text' : 'password'}
            className="api-key-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste your Gemini API key here"
          />
          <button className="btn-secondary" onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button>
          <button className="btn-primary" onClick={handleSave}>{justSaved ? 'Saved!' : 'Save key'}</button>
        </div>

        {!apiKey && (
          <p className="quiz-hint" style={{ marginTop: 12 }}>No key saved yet — reviewer generation won't work until you add one.</p>
        )}
      </div>
    </div>
  )
}

function UploadTitleStep({ title, setTitle, onNext }) {
  return (
    <div className="page">
      <div className="centered-step">
        <h2 className="page-title">Title of Reviewer</h2>
        <div className="input-with-count">
          <input
            type="text"
            value={title}
            maxLength={30}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="char-count">{title.length}/30</span>
        </div>
      </div>
      <div className="page-footer">
        <button className="btn-primary" onClick={onNext}>Next</button>
      </div>
    </div>
  )
}

function UploadSourcesStep({ notes, setNotes, sourceFiles, setSourceFiles, onNext }) {
  const fileInputRef = useRef(null)
  const canProceed = sourceFiles.length > 0 || notes.trim().length > 0

  async function handleFileChange(e) {
    const selected = Array.from(e.target.files)
    e.target.value = ''

    for (const file of selected) {
      const text = await extractTextFromPDF(file)
      setSourceFiles((prev) => [...prev, { file, name: file.name, text }])
    }
  }

  function removeFile(index) {
    setSourceFiles((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="page">
      <h2 className="page-title">Upload your sources</h2>
      <div className="dropzone" onClick={() => fileInputRef.current.click()}>
        <input
          type="file"
          accept="application/pdf"
          multiple
          ref={fileInputRef}
          onChange={handleFileChange}
          hidden
        />
        <div className="dropzone-icon">📄</div>
        <p>Upload your PDF</p>
      </div>
      {sourceFiles.length > 0 && (
        <ul className="file-list">
          {sourceFiles.map((s, i) => (
            <li key={i}>
              {s.name}
              <button type="button" onClick={() => removeFile(i)}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="divider"><span>or paste text</span></div>
      <textarea
        placeholder="Paste your notes here..."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="page-footer">
        <button className="btn-primary" onClick={onNext} disabled={!canProceed}>Next</button>
      </div>
    </div>
  )
}

function ConfigurePage(props) {
  const {
    title, setTitle,
    accentColor, setAccentColor,
    descriptionStyle, setDescriptionStyle,
    quizTypes, setQuizTypes,
    collapsible, setCollapsible,
    includeFinalTest, setIncludeFinalTest,
    includeExamples, setIncludeExamples,
    onFinish,
  } = props

  function toggleQuiz(key) {
    setQuizTypes({ ...quizTypes, [key]: !quizTypes[key] })
  }

  return (
    <div className="page">
      <h2 className="page-title">Configure</h2>
      <div className="configure-grid">
        <div className="configure-col">
          <h3>Title</h3>
          <div className="field-row">
            <label>Reviewer title</label>
            <input
              type="text"
              value={title}
              maxLength={30}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <h3>Display</h3>
          <div className="field-row">
            <label>Accent color</label>
            <div className="color-input">
              <input type="text" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
              <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
            </div>
          </div>

          <h3>Content</h3>
          <div className="option-list">
            <label className="option-item">
              <input type="radio" name="descStyle" checked={descriptionStyle === 'verbatim'} onChange={() => setDescriptionStyle('verbatim')} />
              <div>
                <strong>Verbatim</strong>
                <p>Use the same exact description provided in the source</p>
              </div>
            </label>
            <label className="option-item">
              <input type="radio" name="descStyle" checked={descriptionStyle === 'paraphrase'} onChange={() => setDescriptionStyle('paraphrase')} />
              <div>
                <strong>Paraphrase</strong>
                <p>Paraphrase the original description to be simpler</p>
              </div>
            </label>
          </div>

          <h3>Layout</h3>
          <div className="option-list">
            <label className="option-item">
              <input type="checkbox" checked={collapsible} onChange={() => setCollapsible(!collapsible)} />
              <div>
                <strong>Collapsible sections</strong>
                <p>Let each section expand/collapse individually. Turn off to show everything expanded at once.</p>
              </div>
            </label>
            <label className="option-item">
              <input type="checkbox" checked={includeExamples} onChange={() => setIncludeExamples(!includeExamples)} />
              <div>
                <strong>Worked examples</strong>
                <p>Include step-by-step worked examples where a concept actually calls for one (math, formulas, procedures). Turn off to keep the reviewer to straightforward explanations only, with no examples at all.</p>
              </div>
            </label>
          </div>
        </div>

        <div className="configure-col">
          <h3>Final Test</h3>
          <div className="option-list">
            <label className="option-item">
              <input type="checkbox" checked={includeFinalTest} onChange={() => setIncludeFinalTest(!includeFinalTest)} />
              <div>
                <strong>Generate a Final Test</strong>
                <p>A single test covering every module, generated automatically. Turn off to skip it and finish faster.</p>
              </div>
            </label>
          </div>

          {includeFinalTest && (
            <>
              <h3>Quiz Type</h3>
              <p className="hint">Select at least one.</p>
              <div className="quiz-type-list">
                <label className="quiz-type-item">
                  <input type="checkbox" checked={quizTypes.multipleChoice} onChange={() => toggleQuiz('multipleChoice')} />
                  Multiple Choice
                </label>
                <label className="quiz-type-item">
                  <input type="checkbox" checked={quizTypes.trueFalse} onChange={() => toggleQuiz('trueFalse')} />
                  True or False
                </label>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="page-footer">
        <button className="btn-primary" onClick={onFinish}>Finish</button>
      </div>
    </div>
  )
}

function GeneratingPage({ progress, message, error, onRetry }) {
  if (error) {
    return (
      <div className="page generating">
        <h2 className="page-title">Something went wrong</h2>
        <p className="empty-state">{error}</p>
        <button className="btn-primary" onClick={onRetry}>Try Again</button>
      </div>
    )
  }

  return (
    <div className="page generating">
      <h2 className="page-title">Creating your reviewer...</h2>
      <div className="progress-card">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }}></div>
        </div>
        <div className="progress-meta">
          <p>{message}</p>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>
    </div>
  )
}

function ReviewersPage({ reviewers, onSelect, onDelete, onDownload }) {
  return (
    <div className="page">
      <h2 className="page-title">Reviewers</h2>
      {reviewers.length === 0 ? (
        <p className="empty-state">No reviewers yet. Create one from the Upload tab to get started.</p>
      ) : (
        <div className="reviewers-list">
          {reviewers.map((r) => (
            <div className="reviewer-row" key={r.id} onClick={() => onSelect(r)}>
              <div className="reviewer-row-main">
                <strong>{r.title}</strong>
                <span className="reviewer-date">created {r.created}</span>
              </div>
              <div className="reviewer-row-actions">
                <button
                  type="button"
                  className="icon-btn download"
                  title="Download"
                  onClick={(e) => { e.stopPropagation(); onDownload(r) }}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="icon-btn delete"
                  title="Delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(r) }}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7h16" />
                    <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
                    <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlight(text, query) {
  if (!query || !text) return text
  const parts = String(text).split(new RegExp(`(${escapeRegExp(query)})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query ? <mark key={i}>{part}</mark> : part
  )
}

function QuizSection({ quiz }) {
  const [quizState, setQuizState] = useState('intro') // 'intro' | 'active' | 'finished'
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState({})

  if (!quiz || quiz.length === 0) return null

  const allAnswered = quiz.every((_, i) => answers[i] !== undefined)
  const currentQuestion = quiz[currentIndex]

  function handleStart() {
    setQuizState('active')
    setCurrentIndex(0)
    setAnswers({})
  }
  function handleSelect(option) {
    setAnswers((prev) => ({ ...prev, [currentIndex]: option }))
  }
  function handlePrev() {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
  }
  function handleNext() {
    if (currentIndex < quiz.length - 1) setCurrentIndex(currentIndex + 1)
  }
  function handleSubmit() {
    setQuizState('finished')
  }
  function handleRetake() {
    setQuizState('intro')
    setCurrentIndex(0)
    setAnswers({})
  }

  const score = quiz.reduce((total, q, i) => (answers[i] === q.correctAnswer ? total + 1 : total), 0)

  return (
    <div className="quiz-section">
      {quizState === 'intro' && (
        <div className="quiz-row">
          <h3>Ready to start the Quiz?</h3>
          <button className="btn-primary" onClick={handleStart}>Start</button>
        </div>
      )}

      {quizState === 'active' && (
        <>
          <div className="quiz-row">
            <h3>{currentIndex + 1}. {currentQuestion.question}</h3>
            <div className="quiz-nav">
              <button className="btn-secondary" onClick={handlePrev} disabled={currentIndex === 0}>
                Back
              </button>
              {currentIndex < quiz.length - 1 ? (
                <button className="btn-secondary" onClick={handleNext}>Next</button>
              ) : (
                <button className="btn-primary" onClick={handleSubmit} disabled={!allAnswered}>
                  Submit
                </button>
              )}
            </div>
          </div>
          <div className="quiz-options">
            {(currentQuestion.options || ['True', 'False']).map((option) => {
              const isSelected = answers[currentIndex] === option
              return (
                <label key={option} className={`quiz-option ${isSelected ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name={`quiz-q-${currentIndex}`}
                    checked={isSelected}
                    onChange={() => handleSelect(option)}
                  />
                  {option}
                </label>
              )
            })}
          </div>
          {!allAnswered && currentIndex === quiz.length - 1 && (
            <p className="quiz-hint">Answer all questions before submitting.</p>
          )}
        </>
      )}

      {quizState === 'finished' && (
        <>
          <div className="quiz-row">
            <h3>You scored {score} / {quiz.length}</h3>
            <button className="btn-primary" onClick={handleRetake}>Retake Quiz</button>
          </div>
          <div className="quiz-review">
            {quiz.map((q, i) => {
              const isCorrect = answers[i] === q.correctAnswer
              return (
                <div key={i} className={`quiz-review-item ${isCorrect ? 'correct' : 'incorrect'}`}>
                  <p className="quiz-review-question">{i + 1}. {q.question}</p>
                  <p className="quiz-review-answer">Your answer: {answers[i]}</p>
                  {!isCorrect && (
                    <p className="quiz-review-correct">Correct answer: {q.correctAnswer}</p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function stripHtml(html) {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return tmp.textContent || ''
}

function CollapsibleCard({ headerContent, children, defaultOpen = false, collapsible = true }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const open = collapsible ? isOpen : true
  return (
    <div className={`collapsible-card ${open ? 'open' : ''}`}>
      <button
        className="collapsible-header"
        onClick={() => collapsible && setIsOpen(!isOpen)}
        style={!collapsible ? { cursor: 'default' } : undefined}
      >
        <div className="collapsible-header-content">{headerContent}</div>
        {collapsible && <span className="chev">▸</span>}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  )
}

function ExampleBlock({ example, index }) {
  const [showSolution, setShowSolution] = useState(false)
  return (
    <div className="example-block">
      <div className="example-head">Example {index + 1}{example.tag ? ` — ${example.tag}` : ''}</div>
      <div className="example-problem">{example.problem}</div>
      <button className="example-toggle" onClick={() => setShowSolution(!showSolution)}>
        {showSolution ? 'Hide step-by-step solution' : 'Show step-by-step solution'}
      </button>
      {showSolution && (
        <div className="example-solution">
          {example.steps.map((step, i) => (
            <div className="sol-step" key={i}>
              <span className="step-label">Step {i + 1}:</span> {step}
            </div>
          ))}
          <div className="sol-answer">✅ Final Answer: {example.answer}</div>
        </div>
      )}
    </div>
  )
}

function ConceptCard({ concept, collapsible }) {
  return (
    <CollapsibleCard
      collapsible={collapsible}
      headerContent={<h3>{concept.title}</h3>}
    >
      <div className="concept-def" dangerouslySetInnerHTML={{ __html: concept.definition }} />
      {concept.formula && <div className="formula-box">{concept.formula}</div>}
      {concept.examples && concept.examples.length > 0 && (
        <>
          <div className="examples-label">Worked Examples</div>
          {concept.examples.map((ex, i) => (
            <ExampleBlock key={i} example={ex} index={i} />
          ))}
        </>
      )}
    </CollapsibleCard>
  )
}

function ModuleContent({ module, query = '', collapsible = true }) {
  const startHere = module.concepts && module.concepts.length > 0 ? module.concepts[0] : null
  const restConcepts = module.concepts && module.concepts.length > 1 ? module.concepts.slice(1) : []

  return (
    <div className="module-content">
      {module.summary && (
        <CollapsibleCard collapsible={collapsible} headerContent={<h3>Lesson Summary</h3>}>
          <p>{highlight(module.summary, query)}</p>
        </CollapsibleCard>
      )}

      {(module.keyConcepts || startHere) && (
        <CollapsibleCard collapsible={collapsible} headerContent={<h3>Key Concepts &amp; Terms</h3>}>
          {module.keyConcepts?.vital && module.keyConcepts.vital.length > 0 && (
            <div className="key-vital">
              <h4>Vital Few Ideas</h4>
              <ul>
                {module.keyConcepts.vital.map((v, i) => (
                  <li key={i}>
                    <strong>{highlight(v.idea, query)}</strong> — {highlight(v.why, query)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {module.keyConcepts?.glossary && module.keyConcepts.glossary.length > 0 && (
            <div className="key-glossary">
              <h4>Plain-English Glossary</h4>
              {module.keyConcepts.glossary.map((g, i) => (
                <div className="glossary-item" key={i}>
                  <div className="glossary-term">{highlight(g.term, query)}</div>
                  <div className="glossary-def">{highlight(g.def, query)}</div>
                </div>
              ))}
            </div>
          )}
          {startHere && (
            <div className="key-start-here">
              <h4>Basic Vocabulary</h4>
              <div className="concept-def" dangerouslySetInnerHTML={{ __html: startHere.definition }} />
              {startHere.formula && <div className="formula-box">{startHere.formula}</div>}
              {startHere.examples && startHere.examples.length > 0 && (
                <>
                  <div className="examples-label">Worked Examples</div>
                  {startHere.examples.map((ex, i) => (
                    <ExampleBlock key={i} example={ex} index={i} />
                  ))}
                </>
              )}
            </div>
          )}
        </CollapsibleCard>
      )}

      {restConcepts.map((concept, i) => (
        <ConceptCard key={i} concept={concept} collapsible={collapsible} />
      ))}
    </div>
  )
}

function ReviewerViewer({ reviewer, onBack }) {
  const [activeTab, setActiveTab] = useState(0)
  const [fontScale, setFontScale] = useState(1)
  const [theme, setTheme] = useState('light')
  const [searchQuery, setSearchQuery] = useState('')

  const tabs = [
    ...reviewer.modules.map((m, i) => ({ key: i, label: m.title })),
    ...(reviewer.finalTest ? [{ key: 'final-test', label: 'Final Test' }] : []),
  ]

  const query = searchQuery.trim().toLowerCase()

  function moduleHasMatch(module) {
    if (!query) return true
    const haystack = [
      module.summary,
      ...(module.keyConcepts?.vital || []).flatMap((v) => [v.idea, v.why]),
      ...(module.keyConcepts?.glossary || []).flatMap((g) => [g.term, g.def]),
      ...(module.concepts || []).flatMap((c) => [c.title, c.classification, stripHtml(c.definition || '')]),
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(query)
  }

  useEffect(() => {
    if (!query) return
    const active = tabs.find((t) => t.key === activeTab)
    const activeModule = typeof active?.key === 'number' ? reviewer.modules[active.key] : null
    if (active?.key === 'final-test') return
    if (activeModule && moduleHasMatch(activeModule)) return
    const firstMatch = reviewer.modules.findIndex((m) => moduleHasMatch(m))
    if (firstMatch !== -1) setActiveTab(firstMatch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const activeModule = typeof activeTab === 'number' ? reviewer.modules[activeTab] : null

  function increaseFontScale() {
    setFontScale((s) => Math.min(Number((s + 0.1).toFixed(1)), 1.4))
  }
  function decreaseFontScale() {
    setFontScale((s) => Math.max(Number((s - 0.1).toFixed(1)), 0.8))
  }
  function toggleTheme() {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'))
  }

  return (
    <div className={`page viewer-page ${theme === 'dark' ? 'dark-theme' : ''}`}>
      <div className="viewer-topbar">
        <h2 className="viewer-page-title">
          <button className="back-arrow" onClick={onBack} title="Back to Reviewers">←</button>
          {reviewer.title}
        </h2>
        <div className="viewer-search">
          <input
            type="text"
            placeholder="Search all modules..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <svg className="viewer-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <div className="viewer-topbar-actions">
          <div className="font-size-control">
            <button className="font-btn" onClick={decreaseFontScale}>A-</button>
            <span className="font-btn-divider" />
            <button className="font-btn" onClick={increaseFontScale}>A+</button>
          </div>
          <button className="theme-btn" onClick={toggleTheme}>
            {theme === 'light' ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>

      <div className="viewer-tabs">
        {tabs.map((tab) => {
          const tabModule = typeof tab.key === 'number' ? reviewer.modules[tab.key] : null
          const hasMatch = tabModule ? moduleHasMatch(tabModule) : true
          return (
            <button
              key={tab.key}
              className={`viewer-tab ${activeTab === tab.key ? 'active' : ''} ${query && !hasMatch ? 'dimmed' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="viewer-content" style={{ zoom: fontScale }}>
        {activeModule && (
          <div key={activeTab} className="tab-fade">
            <h3 className="module-title">{activeModule.title}</h3>
            <ModuleContent module={activeModule} query={query} collapsible={reviewer.collapsible !== false} />
          </div>
        )}
        {activeTab === 'final-test' && (
          <div key="final-test" className="tab-fade module-content">
            <h3 className="module-title">Final Test</h3>
            <QuizSection quiz={reviewer.finalTest} />
          </div>
        )}
      </div>
    </div>
  )
}

export default App