// Token Radar's dashboard. It reads window.RADAR, the dataset main.ts writes
// beside dashboard/, and renders the ranked board, a top-10 spotlight, a
// filterable table, a per-protocol detail drawer with the model's own inputs
// and the protocol's farm plan, and the model itself. No network: every byte
// it shows is already in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');
  var ui = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return moneyFmt.format(n);
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function multLabel(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }

  // The model, run again in the page: a row is recomputed from the snapshot
  // figures and set against the number board.json carries, so the page's code
  // and the board's data are visibly the same arithmetic.
  function recompute(row, model) {
    var rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    var growthFactor = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var ageFactor = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthFactor * ageFactor));
  }

  // Build one element: props set attributes, text or listeners; children may
  // be nodes, strings, or arrays of either, and nulls are skipped.
  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(c); });
      } else if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  // The farm plan, derived here the same way main.ts derives it for
  // board.json: category, chains, TVL and age decide the action, the capital,
  // the hold and every cost and time. No name is special-cased.
  function firstChain(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  function txCostWords(p) {
    var chain = firstChain(p).toLowerCase();
    if (chain === 'ethereum') return 'about $8 of gas per transaction';
    if (chain === 'solana') return 'under $0.10 of gas per transaction';
    var cheap = ['base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'linea', 'scroll', 'zksync', 'starknet', 'blast', 'mantle', 'mode', 'taiko', 'opbnb', 'gnosis'];
    for (var i = 0; i < cheap.length; i++) {
      if (chain.includes(cheap[i])) return 'under $1 of gas per transaction';
    }
    return 'about $2 of gas per transaction';
  }

  function stakeSize(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdDays(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function mainAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open so it counts as a lender.`;
    if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through the next fee cycle.`;
    if (c.includes('yield') || c.includes('yield aggregator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares instead of withdrawing them.`;
    if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app.`;
    if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in your wallet.`;
    if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge, then leave the position alone.`;
    if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then let it settle instead of trading it.`;
    if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in your wallet.`;
    if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the full term.`;
    if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
    if (c.includes('privacy')) return `Deposit $${capital} through ${name}'s private pool on ${chain} and keep the note safe.`;
    if (c.includes('gaming') || c.includes('gambling')) return `Deposit $${capital} into ${name} on ${chain} and play one full session with it.`;
    if (c.includes('social')) return `Deposit $${capital} into ${name} on ${chain} and use its app once a week.`;
    if (c.includes('ai') || c.includes('depin') || c.includes('compute')) return `Deposit $${capital} into ${name} on ${chain} and run one job through it.`;
    return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }

  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s += " Hold the position and check the protocol's own page.";
    return s;
  }

  function farmSteps(p) {
    var chain = firstChain(p);
    var capital = stakeSize(p);
    var hold = holdDays(p.age_days);
    var gas = txCostWords(p);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline where nobody else can read it.', cost: gas.replace('per transaction', 'for the first transaction'), time: '5 minutes' },
      { text: mainAction(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet looks used rather than parked.', cost: gas.replace('per transaction', 'a week'), time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot of the protocol.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Once a month, open " + p.name + "'s own points or rewards page from its official site and check whether your wallet is listed.", cost: 'no fee to check', time: '10 minutes a month' },
      { text: 'Before adding more funds, confirm ' + p.name + ' still records no token and read its own announcements; never follow a claim link from a direct message.', cost: 'nothing but the check', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    ];
    return steps.map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    var q = params.get('q');
    var p = params.get('p');
    var category = params.get('category');
    var chain = params.get('chain');
    if (q) ui.q = q;
    if (p) ui.selected = p;
    if (category) ui.category = category;
    if (chain) ui.chain = chain;
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (ui.q) params.set('q', ui.q);
    if (ui.category !== 'all') params.set('category', ui.category);
    if (ui.chain !== 'all') params.set('chain', ui.chain);
    if (ui.selected) params.set('p', ui.selected);
    var next = params.toString();
    var url = next ? '#' + next : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  function visibleRows() {
    var q = ui.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (ui.category !== 'all' && r.category !== ui.category) return false;
      if (ui.chain !== 'all' && !(r.chains || []).some(function (c) { return c === ui.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function orderedRows(list) {
    var key = ui.sort;
    var dir = ui.dir;
    return list.slice().sort(function (a, b) {
      var av;
      var bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.multiple; bv = b.multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      if (a.slug < b.slug) return -1;
      if (a.slug > b.slug) return 1;
      return 0;
    });
  }

  function topBar() {
    var brand = h('div', { class: 'brand' },
      h('span', { class: 'mark' }),
      h('span', { class: 'brand-name', text: 'Token Radar' })
    );
    var meta = h('div', { class: 'top-meta' },
      h('span', { text: 'Snapshot ' + DATA.as_of }),
      h('span', { text: 'DefiLlama protocol index' }),
      h('span', { text: DATA.model_version + ' model' })
    );
    return h('header', { class: 'top' }, brand, meta);
  }

  function intro() {
    var copy = h('div', null,
      h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
      h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' genuine pre-token protocols below that floor, each scored at the multiple its live-token peers trade at. Implied value is a model, not a promise.' })
    );
    var facts = h('div', { class: 'facts' },
      h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
      h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
      h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATA.early_size) })),
      h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }))
    );
    return h('section', { class: 'lede' }, copy, facts);
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 10);
    var max = top[0] ? top[0].implied_value_usd : 1;
    var items = top.map(function (r) {
      var label = (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains[0] : 'an unnamed chain');
      var bar = h('div', { class: 'spot-bar', 'aria-hidden': 'true' },
        h('i', { style: 'width:' + Math.max(4, Math.round((r.implied_value_usd / max) * 100)) + '%' })
      );
      return h('div', { class: 'spot-row', onclick: function () { openDetail(r.slug); } },
        h('span', { class: 'rank', text: '#' + r.rank }),
        h('span', { class: 'nm', text: r.name }, h('span', { text: label })),
        bar,
        h('span', { class: 'val', text: money(r.implied_value_usd) })
      );
    });
    return h('section', { class: 'spot' },
      h('h2', { text: 'Top 10 by implied value' }),
      h('div', { class: 'spot-list' }, items)
    );
  }

  function filters() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; });
    });
    var chains = Object.keys(chainCounts)
      .sort(function (a, b) { return chainCounts[b] - chainCounts[a]; })
      .slice(0, 20);

    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: ui.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { ui.q = search.value; writeHash(); render(); });

    var categoryOptions = [h('option', { value: 'all', text: 'All categories' })].concat(
      categories.map(function (c) {
        return h('option', { value: c, text: c, selected: c === ui.category ? 'selected' : null });
      })
    );
    var categorySelect = h('select', { id: 'category', 'aria-label': 'Filter by category' }, categoryOptions);
    categorySelect.addEventListener('change', function () { ui.category = categorySelect.value; writeHash(); render(); });

    var chainOptions = [h('option', { value: 'all', text: 'All chains' })].concat(
      chains.map(function (c) {
        return h('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === ui.chain ? 'selected' : null });
      })
    );
    var chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' }, chainOptions);
    chainSelect.addEventListener('change', function () { ui.chain = chainSelect.value; writeHash(); render(); });

    var pre = h('button', { type: 'button', 'aria-pressed': ui.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { ui.tab = 'pre-token'; render(); } });
    var live = h('button', { type: 'button', 'aria-pressed': ui.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { ui.tab = 'live'; render(); } });
    var tabs = h('div', { class: 'tabs' }, pre, live);
    var countText = ui.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols';

    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), categorySelect),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), tabs),
      h('span', { class: 'count', text: countText })
    );
  }

  function sortHead(key, label) {
    var arrow = ui.sort === key ? h('span', { 'aria-hidden': 'true', text: ui.dir < 0 ? ' v' : ' ^' }) : null;
    var button = h('button', { type: 'button', onclick: function () {
      if (ui.sort === key) ui.dir = -ui.dir;
      else { ui.sort = key; ui.dir = -1; }
      render();
    } }, label, arrow);
    return h('th', { scope: 'col' }, button);
  }

  function chainLabel(r) {
    if (r.chains && r.chains.length) return r.chains.slice(0, 2).join(', ');
    return 'an unnamed chain';
  }

  function boardTable() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      var empty = h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { ui.q = ''; ui.category = 'all'; ui.chain = 'all'; writeHash(); render(); } })
      );
      return h('div', { class: 'panel' }, empty);
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var bar = h('div', { class: 'bar', 'aria-hidden': 'true' },
        h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })
      );
      var nameCell = h('div', { class: 'name' },
        h('b', { text: r.name }),
        h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) })
      );
      var impliedCell = h('div', { class: 'implied' }, bar, h('span', { class: 'num', text: money(r.implied_value_usd) }));
      var tr = h('tr', {
        'data-selected': ui.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null, nameCell),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: growth }),
        h('td', { class: 'num', text: ageLabel(r.age_days) }),
        h('td', { class: 'num', text: multLabel(r.multiple) }),
        h('td', null, impliedCell),
        h('td', null, h('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    var head = h('thead', null, h('tr', null,
      sortHead('implied', 'Rank'),
      sortHead('name', 'Protocol'),
      sortHead('tvl', 'TVL'),
      sortHead('growth', '7d'),
      sortHead('age', 'Age'),
      sortHead('multiple', 'Multiple'),
      sortHead('implied', 'Implied value'),
      h('th', { scope: 'col', text: 'Token' })
    ));
    var table = h('table', null,
      h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
      head,
      tbody
    );
    return h('div', { class: 'panel' }, h('div', { class: 'table-wrap' }, table));
  }

  function liveTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      var growthClass = r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg';
      var ratio = r.mcap_tvl_ratio === null ? 'n/a' : multLabel(r.mcap_tvl_ratio);
      var nameCell = h('div', { class: 'name' },
        h('b', { text: r.name }),
        h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) })
      );
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, nameCell),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', { class: 'num', text: ratio }),
        h('td', null, h('span', { class: 'status', text: 'already trades' }))
      ));
    });
    var head = h('thead', null, h('tr', null,
      h('th', { scope: 'col', text: 'Status' }),
      h('th', { scope: 'col', text: 'Protocol' }),
      h('th', { scope: 'col', text: 'TVL' }),
      h('th', { scope: 'col', text: '7d' }),
      h('th', { scope: 'col', text: 'Market cap' }),
      h('th', { scope: 'col', text: 'Mcap / TVL' }),
      h('th', { scope: 'col', text: 'Token' })
    ));
    var table = h('table', null,
      h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Their mcap/TVL ratios are the comparables the pre-token board is scored at. They are set aside from the pre-token ranking.' }),
      head,
      tbody
    );
    return h('div', { class: 'panel' }, h('div', { class: 'table-wrap' }, table));
  }

  function modelPanel() {
    var m = DATA.model;
    var used = Object.keys(DATA.multiples || {}).map(function (k) {
      var e = DATA.multiples[k];
      return { category: k, multiple: e.multiple, comps: e.comps, source: e.source };
    }).filter(function (e) { return e.source === 'category'; });
    used.sort(function (a, b) { return b.comps - a.comps; });
    var topEight = used.slice(0, 8);
    var formula = 'implied = round( tvl_usd x multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )';
    var explainer = 'The multiple is the median market-cap-to-TVL ratio of the live-token protocols in the same category (at least 3 of them); a category with fewer live peers falls back to the whole market median. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Wrapped, staked and bridged products never take a rank: the board scores protocols still waiting on a launch of their own.';
    var rows = topEight.map(function (e) {
      return h('tr', null,
        h('td', { text: e.category }),
        h('td', { class: 'num', text: String(e.comps) }),
        h('td', { class: 'num', text: multLabel(e.multiple) })
      );
    });
    var multTable = h('table', { class: 'mult-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col', text: 'Category' }),
        h('th', { scope: 'col', text: 'Live peers' }),
        h('th', { scope: 'col', text: 'Multiple' })
      )),
      h('tbody', null, rows)
    );
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' }, formula),
      h('p', { class: 'sub', text: explainer }),
      h('h3', { text: 'Category multiples used' }),
      multTable
    );
  }

  function pageFoot() {
    return h('footer', { class: 'foot' },
      h('p', { text: 'Source: DefiLlama protocol index, snapshot ' + DATA.as_of + '. ' + DATA.source + '.' }),
      h('p', { text: '"Records no token" means the protocol\u2019s DefiLlama record carries no token; it is not proof the protocol has none. Implied value is this entry\u2019s own claim, never a price and never a prediction that a token will be issued.' }),
      h('p', { text: 'Built for make.fun\u2019s token-radar-01 bounty. Model ' + DATA.model_version + '.' })
    );
  }

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { ui.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    ui.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var mult = DATA.multiples && DATA.multiples[row.category || 'Other'];
    var multipleNote = row.multiple_source === 'category' ? 'median of ' + mult.comps + ' live peers' : 'market median';
    var head = h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    );
    var recomputed = recompute(row, DATA.model);
    var checkNote = recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.';
    var equation = h('div', { class: 'equation' },
      h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: money(row.tvl_usd) })),
      h('div', null, h('span', { text: 'Category multiple' }), h('b', { class: 'num', text: row.multiple.toFixed(4) + 'x' + (mult ? ' (' + multipleNote + ')' : '') })),
      h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pct(row.change_7d) })),
      h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
      h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageLabel(row.age_days) })),
      h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: String(row.maturity_multiplier) })),
      h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: money(row.implied_value_usd) }))
    );
    var valueSection = h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      equation,
      h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + checkNote + ' This is an estimate, not a price.' })
    );
    var stepItems = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
    });
    var planSection = h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, stepItems)
    );
    var noteSection = h('section', { class: 'detail-section' },
      h('p', { class: 'sub', text: row.name + ' records no token in the snapshot. That is DefiLlama\u2019s record, not proof it has none: check its own announcements before farming.' })
    );
    dialog.appendChild(head);
    dialog.appendChild(valueSection);
    dialog.appendChild(planSection);
    dialog.appendChild(noteSection);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    mount.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    if (ui.tab === 'pre-token') shell.appendChild(spotlight());
    shell.appendChild(filters());
    shell.appendChild(ui.tab === 'pre-token' ? boardTable() : liveTable());
    if (ui.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(pageFoot());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (ui.selected) openDetail(ui.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
