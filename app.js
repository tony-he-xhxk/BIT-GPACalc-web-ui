/* ============================================================
   GPA Calculator v1.0 · Web 版
   逻辑由 Python 版（GPA_Calculator.py）完整翻译：
   - 百分制 X<60 -> GP=0；否则 GP=4-3*(100-X)^2/1600
   - 五级制查表 {优秀:4.0, 良好:3.6, 中等:2.8, 及格:1.7, 不及格:0.0}
   - GPA = Σ(学分×GP) / Σ(学分)，GP/GPA 保留 1 位小数
   - 成绩一律整数（百分制），五级制下拉，学期可自定义
   数据：本地内存，用户通过「保存条目」下载 json、导入上次 json
   ============================================================ */

'use strict';

// ============ 计算逻辑（纯函数，可单测） ============

const DEFAULT_SEMESTERS = ['大一上', '大一下', '大二上', '大二下',
                           '大三上', '大三下', '大四上', '大四下'];
const GRADE5_GP = { '优秀': 4.0, '良好': 3.6, '中等': 2.8, '及格': 1.7, '不及格': 0.0 };
const GRADE5_LIST = Object.keys(GRADE5_GP);

function calcGpPrecise(entry) {
  if (entry.type === 'percent') {
    const x = entry.score;
    if (x < 60) return 0.0;
    return 4 - 3 * (100 - x) ** 2 / 1600;
  }
  return GRADE5_GP[entry.grade];
}

function calcGpDisplay(entry) {
  return Math.round(calcGpPrecise(entry) * 10) / 10;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function calcGpa(entries) {
  let totalCredit = 0;
  for (const e of entries) totalCredit += e.credit;
  const n = entries.length;
  if (totalCredit <= 0 || n === 0) return [0.0, Math.round(totalCredit * 100) / 100, n];
  let gpSum = 0;
  for (const e of entries) gpSum += e.credit * calcGpPrecise(e);
  return [round1(gpSum / totalCredit), Math.round(totalCredit * 100) / 100, n];
}

function fmtCredit(c) {
  // Python f"{credit:g}"：整数不带小数位，否则去尾零
  return String(parseFloat(c.toFixed(2)));
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

// 校验表单（返回 [entry|null, error]）
function validateEntry(sem, course, creditText, type, scoreText, grade) {
  sem = sem.trim();
  course = course.trim();
  if (!sem) return [null, '学期不能为空'];
  if (!course) return [null, '课程名称不能为空'];
  const credit = Number(creditText.trim());
  if (!Number.isFinite(credit)) return [null, '学分必须是数字（如 5.5）'];
  if (!(credit > 0 && credit <= 30)) return [null, '学分需在 0 ~ 30 之间'];
  if (type === 'percent') {
    const s = scoreText.trim();
    if (!/^\d+$/.test(s)) return [null, '百分制成绩必须是整数（0-100）'];
    const score = parseInt(s, 10);
    if (!(score >= 0 && score <= 100)) return [null, '百分制成绩需在 0-100 之间'];
    return [{ semester: sem, course, credit, type: 'percent', score }, null];
  }
  if (!(grade in GRADE5_GP)) return [null, '请选择五级制评级'];
  return [{ semester: sem, course, credit, type: 'grade5', grade }, null];
}

// 最高/最低统计（按精确 GP 比较；并列用顿号；返回 [text 或 '', maxCourses, minCourses]）
function buildStatsText(entries) {
  if (!entries.length) return '';
  const precise = entries.map(e => [e, calcGpPrecise(e)]);
  let maxGp = -Infinity, minGp = Infinity;
  for (const [, p] of precise) { if (p > maxGp) maxGp = p; if (p < minGp) minGp = p; }
  const maxCourses = precise.filter(([, p]) => p === maxGp).map(([e]) => e.course).join('、');
  const minCourses = precise.filter(([, p]) => p === minGp).map(([e]) => e.course).join('、');
  return `当前所有课程最高 GP 为 ${maxGp.toFixed(1)}（${maxCourses}），最低 GP 为 ${minGp.toFixed(1)}（${minCourses}）`;
}

// 数据序列化（与 Python 版 gpa_data.json 同构）
function serializeData(entries, semesters) {
  return JSON.stringify({ version: 1, entries, semesters }, null, 2);
}

// 下载文件名：gpa_data_yyyy_mm_dd_hh_mm_ss_N门数据.json（本地时区时间）
function buildDataFileName(count) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}_${p(d.getMonth() + 1)}_${p(d.getDate())}_` +
             `${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
  return `gpa_data_${ts}_${count}门数据.json`;
}

// 解析导入数据（返回 [entries, semesters] 或抛出 Error）
function parseImported(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.entries)) throw new Error('缺少 entries 数组');
  for (const e of data.entries) {
    if (!e || typeof e !== 'object' || !e.id || !e.semester || !e.course ||
        typeof e.credit !== 'number' || !(e.type === 'percent' || e.type === 'grade5')) {
      throw new Error('条目格式不正确');
    }
    if (e.type === 'percent' && typeof e.score !== 'number') throw new Error('百分制条目缺少 score');
    if (e.type === 'grade5' && !(e.grade in GRADE5_GP)) throw new Error('五级制条目缺少 grade');
  }
  const semesters = Array.isArray(data.semesters) && data.semesters.length
    ? data.semesters.slice() : DEFAULT_SEMESTERS.slice();
  for (const e of data.entries) {
    if (e.semester && !semesters.includes(e.semester)) semesters.push(e.semester);
  }
  return [data.entries, semesters];
}

// ============ UI 逻辑（DOM） ============

const $ = id => document.getElementById(id);

const state = {
  entries: [],
  semesters: DEFAULT_SEMESTERS.slice(),
  editingId: null,
  gpCache: {},       // id -> "GP x.x"
  semChecks: {},     // semester -> checkbox 元素
  appEnabled: false, // 是否通过首次/免责流程进入
};

const els = {};
const refs = ['saveBtn', 'statusDot', 'statusText', 'semSelect', 'semCustom', 'semCustomRow', 'courseInput',
  'creditInput', 'scoreInput', 'gradeSelect', 'submitBtn', 'clearBtn', 'editHint', 'errorText',
  'listCount', 'entryList', 'statsText', 'calcAllBtn', 'gpaChecks', 'checkAllBtn', 'checkNoneBtn',
  'calcGpaBtn', 'gpaHint', 'gpaValue', 'creditValue', 'courseValue',
  'onboardingModal', 'firstUseBtn', 'importFirstBtn',
  'disclaimerModal', 'disclaimerOkBtn',
  'saveRemindModal', 'saveRemindOkBtn',
  'confirmModal', 'confirmTitle', 'confirmMsg', 'confirmCancelBtn', 'confirmYesBtn',
  'fileInput'];
refs.forEach(id => { els[id] = $(id); });

// ---------- 工具 ----------
function setStatus(text, ok = true) {
  els.statusText.textContent = text;
  els.statusDot.style.background = ok ? 'var(--accent)' : 'var(--danger)';
}

function setError(text) {
  els.errorText.textContent = text;
}

function setEditHint(text) {
  els.editHint.textContent = text;
}

function modalShow(id) { els[id].style.display = 'flex'; }
function modalHide(id) { els[id].style.display = 'none'; }

function showConfirm(title, msg, onYes) {
  els.confirmTitle.textContent = title;
  els.confirmMsg.textContent = msg;
  modalShow('confirmModal');
  const done = () => {
    modalHide('confirmModal');
    els.confirmYesBtn.removeEventListener('click', doYes);
  };
  const doYes = () => { done(); onYes(); };
  els.confirmYesBtn.onclick = doYes;
  els.confirmCancelBtn.onclick = done;
}

// ---------- 学期选择（原生 select + 自定义联动） ----------
function renderSemesterSelect() {
  const sel = els.semSelect;
  sel.innerHTML = '';
  state.semesters.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  });
  const custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = '自定义学期…';
  sel.appendChild(custom);
}

function getSemester() {
  if (els.semSelect.value === '__custom__') return els.semCustom.value.trim();
  return els.semSelect.value;
}

function setSemester(s) {
  const opts = Array.from(els.semSelect.options).map(o => o.value);
  if (opts.includes(s)) {
    els.semSelect.value = s;
    els.semCustomRow.style.display = 'none';
  } else {
    els.semSelect.value = '__custom__';
    els.semCustom.value = s;
    els.semCustomRow.style.display = '';
  }
}

function syncSemInput() {
  const prev = getSemester() || (state.semesters.length ? state.semesters[0] : '大一上');
  renderSemesterSelect();
  setSemester(prev);
}

// ---------- 计算方式联动 ----------
function onTypeChange() {
  const type = document.querySelector('input[name="type"]:checked').value;
  if (type === 'percent') {
    els.gradeSelect.style.display = 'none';
    els.scoreInput.style.display = '';
    els.scoreInput.classList.add('input-highlight');
  } else {
    els.scoreInput.style.display = 'none';
    els.gradeSelect.style.display = '';
  }
}

// ---------- 表单 ----------
function onClear(keepSemester = false) {
  state.editingId = null;
  if (!keepSemester) {
    setSemester(state.semesters.length ? state.semesters[0] : '大一上');
    els.semCustom.value = '';
  }
  els.courseInput.value = '';
  els.creditInput.value = '';
  els.scoreInput.value = '';
  els.gradeSelect.value = GRADE5_LIST[0];
  document.querySelector('input[name="type"][value="percent"]').checked = true;
  onTypeChange();
  setEditHint('');
  setError('');
  els.submitBtn.textContent = '＋ 添加条目';
  els.submitBtn.className = 'btn btn-accent';
}

function onSubmit() {
  const type = document.querySelector('input[name="type"]:checked').value;
  const [entry, err] = validateEntry(
    getSemester(), els.courseInput.value, els.creditInput.value,
    type, els.scoreInput.value, els.gradeSelect.value);
  if (err) { setError(err); return; }
  setError('');

  if (!state.semesters.includes(entry.semester)) {
    state.semesters.push(entry.semester);
  }

  if (state.editingId) {
    const idx = state.entries.findIndex(e => e.id === state.editingId);
    if (idx >= 0) {
      state.entries[idx] = { ...state.entries[idx], ...entry };
    }
    delete state.gpCache[state.editingId]; // 成绩已变，旧 GP 失效
    setStatus('已修改 · 数据在内存中');
  } else {
    entry.id = genId();
    state.entries.push(entry);
    setStatus('已添加 · 数据在内存中');
  }
  syncSemInput();
  onClear(true);            // 保留学期，方便连续录入
  refreshEntries();
  refreshGpaArea();
}

// ---------- 条目渲染 ----------
function renderScoreText(e) {
  return e.type === 'percent' ? `${e.score} 分` : e.grade;
}

function refreshEntries() {
  els.entryList.innerHTML = '';
  els.listCount.textContent = `${state.entries.length} 门`;

  if (!state.entries.length) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '暂无条目，请在左侧添加';
    els.entryList.appendChild(hint);
    els.statsText.textContent = '';
    return;
  }

  state.entries.forEach(e => {
    const row = document.createElement('div');
    row.className = 'entry-row';

    const info = document.createElement('div');
    info.className = 'entry-info';
    const name = document.createElement('div');
    name.className = 'entry-name';
    name.textContent = e.course;
    const meta = document.createElement('div');
    meta.className = 'entry-meta';
    meta.textContent = `${e.semester} · ${fmtCredit(e.credit)} 学分 · ${renderScoreText(e)}`;
    info.appendChild(name);
    info.appendChild(meta);

    const gpLbl = document.createElement('span');
    const cached = state.gpCache[e.id];
    gpLbl.className = 'gp-label' + (cached ? '' : ' empty');
    gpLbl.textContent = cached || '—';

    // 第一行：信息在左，GP 在右
    const main = document.createElement('div');
    main.className = 'entry-main';
    main.appendChild(info);
    main.appendChild(gpLbl);

    // 第二行：操作按钮在条目下方
    const actions = document.createElement('div');
    actions.className = 'entry-actions';

    const btnCalc = document.createElement('button');
    btnCalc.className = 'btn btn-mini btn-calc';
    btnCalc.textContent = '计算 GP';
    btnCalc.onclick = () => onCalcGp(e.id);
    actions.appendChild(btnCalc);

    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn btn-mini btn-edit';
    btnEdit.textContent = '修改';
    btnEdit.onclick = () => onEdit(e.id);
    actions.appendChild(btnEdit);

    const btnDel = document.createElement('button');
    btnDel.className = 'btn btn-mini btn-del';
    btnDel.textContent = '删除';
    btnDel.onclick = () => onDelete(e.id);
    actions.appendChild(btnDel);

    row.appendChild(main);
    row.appendChild(actions);
    els.entryList.appendChild(row);
  });

  els.statsText.textContent = buildStatsText(state.entries);
}

// ---------- GP 计算 ----------
function onCalcGp(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  const text = `GP ${calcGpDisplay(e).toFixed(1)}`;
  state.gpCache[id] = text;
  // 就地更新该行 GP 标签（无需整体重建）
  const row = els.entryList.querySelector(`.entry-row[data-id="${id}"] .gp-label`);
  if (row) { row.textContent = text; row.classList.remove('empty'); }
  setStatus(`${e.course} GP = ${calcGpDisplay(e).toFixed(1)}`);
}

function onCalcAllGp() {
  if (!state.entries.length) { setStatus('暂无条目可计算', false); return; }
  let newCount = 0;
  state.entries.forEach(e => {
    if (e.id in state.gpCache) return;
    const text = `GP ${calcGpDisplay(e).toFixed(1)}`;
    state.gpCache[e.id] = text;
    newCount++;
  });
  refreshEntries(); // 统一重建显示（含缓存值）
  const total = state.entries.length;
  setStatus(newCount ? `一键计算完成：新计算 ${newCount} 门 · 共 ${total} 门` : `全部 ${total} 门已计算完成`);
}

// ---------- 编辑 / 删除 ----------
function onEdit(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  state.editingId = id;
  setSemester(e.semester);
  els.courseInput.value = e.course;
  els.creditInput.value = fmtCredit(e.credit);
  const typeRadio = document.querySelector(`input[name="type"][value="${e.type}"]`);
  typeRadio.checked = true;
  onTypeChange();
  if (e.type === 'percent') {
    els.scoreInput.value = String(e.score);
  } else {
    els.gradeSelect.value = e.grade;
  }
  setEditHint(`正在修改：${e.course}`);
  setError('');
  els.submitBtn.textContent = '保存修改';
  els.submitBtn.className = 'btn btn-accent-dark';
}

function onDelete(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  showConfirm('删除确认', `确定删除「${e.course}」这条记录？`, () => {
    state.entries = state.entries.filter(x => x.id !== id);
    delete state.gpCache[id];
    if (state.editingId === id) onClear();
    refreshEntries();
    refreshGpaArea();
    setStatus('已删除 · 数据在内存中');
  });
}

// ---------- GPA 区 ----------
function refreshGpaArea() {
  els.gpaChecks.innerHTML = '';
  state.semChecks = {};
  if (!state.semesters.length) {
    els.gpaChecks.textContent = '暂无学期数据';
    return;
  }
  state.semesters.forEach(s => {
    const label = document.createElement('label');
    label.className = 'radio-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + s));
    els.gpaChecks.appendChild(label);
    state.semChecks[s] = cb;
  });
}

function checkAll() {
  Object.values(state.semChecks).forEach(cb => { cb.checked = true; });
}
function checkNone() {
  Object.values(state.semChecks).forEach(cb => { cb.checked = false; });
}

function onCalcGpa() {
  const selected = Object.entries(state.semChecks)
    .filter(([, cb]) => cb.checked)
    .map(([s]) => s);
  if (!selected.length) {
    els.gpaHint.textContent = '请先勾选至少一个学期';
    els.gpaHint.classList.add('warn');
    return;
  }
  const entries = state.entries.filter(e => selected.includes(e.semester));
  if (!entries.length) {
    els.gpaHint.textContent = '所选学期暂无课程数据';
    els.gpaHint.classList.add('warn');
    els.gpaValue.textContent = '0.0';
    els.creditValue.textContent = '0';
    els.courseValue.textContent = '0 门';
    return;
  }
  const [gpa, credit, n] = calcGpa(entries);
  els.gpaValue.textContent = gpa.toFixed(1);
  els.creditValue.textContent = fmtCredit(credit);
  els.courseValue.textContent = `${n} 门`;
  els.gpaHint.textContent = `已选 ${selected.length} 个学期：${selected.join('、')}`;
  els.gpaHint.classList.remove('warn');
  setStatus(`GPA = ${gpa.toFixed(1)} · 总学分 ${fmtCredit(credit)}`);
}

// ---------- 保存 / 导入 ----------
function saveToFile() {
  const data = serializeData(state.entries, state.semesters);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildDataFileName(state.entries.length);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus(`已保存 ${state.entries.length} 条 · 文件已下载`);
}

function importFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const [entries, semesters] = parseImported(reader.result);
      state.entries = entries;
      state.semesters = semesters;
      state.gpCache = {};
      state.editingId = null;
      syncSemInput();
      refreshEntries();
      refreshGpaArea();
      onClear();
      modalHide('onboardingModal');
      enableApp();
      setStatus(`导入成功 · ${entries.length} 条记录`);
    } catch (err) {
      alert('导入失败：' + err.message); // 文件错误提示，不影响流程
    }
  };
  reader.readAsText(file);
}

// ---------- 入口流程 ----------
function enableApp() {
  state.appEnabled = true;
  setStatus('内存数据');
}

function startOnboarding() {
  // 页面加载即弹出首次使用询问（无 X 关闭、点遮罩不关闭）
  modalShow('onboardingModal');
}

// 首次使用 -> 免责声明
els.firstUseBtn.onclick = () => {
  modalHide('onboardingModal');
  modalShow('disclaimerModal');
};

// 老用户 -> 文件选择器导入
els.importFirstBtn.onclick = () => {
  els.fileInput.click();
};

// 免责声明确定
els.disclaimerOkBtn.onclick = () => {
  const val = document.querySelector('input[name="disclaimer"]:checked').value;
  if (val === 'accept') {
    modalHide('disclaimerModal');
    enableApp();
  } else {
    // 不同意 -> 退出本站（跳转个人主页）
    window.location.href = 'https://xingheling.cn';
  }
};

// ---------- 事件绑定 ----------
els.saveBtn.onclick = saveToFile;
els.submitBtn.onclick = onSubmit;
els.clearBtn.onclick = () => onClear(false);
els.calcAllBtn.onclick = onCalcAllGp;
els.calcGpaBtn.onclick = () => {
  // 计算 GPA 前强制提醒保存（有数据时）
  if (state.entries.length) {
    modalShow('saveRemindModal');
  } else {
    onCalcGpa();
  }
};
els.saveRemindOkBtn.onclick = () => {
  const choice = document.querySelector('input[name="saveChoice"]:checked').value;
  modalHide('saveRemindModal');
  if (choice === 'save') saveToFile();
  onCalcGpa();
};
els.checkAllBtn.onclick = checkAll;
els.checkNoneBtn.onclick = checkNone;
els.semSelect.addEventListener('change', () => {
  if (els.semSelect.value === '__custom__') {
    els.semCustomRow.style.display = '';
    els.semCustom.focus();
  } else {
    els.semCustomRow.style.display = 'none';
    els.semCustom.value = '';
  }
});
document.querySelectorAll('input[name="type"]').forEach(r => {
  r.addEventListener('change', onTypeChange);
});
els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files.length) importFromFile(els.fileInput.files[0]);
  els.fileInput.value = '';
});

// ---------- 初始化 ----------
function init() {
  syncSemInput();
  els.gradeSelect.innerHTML = '';
  GRADE5_LIST.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    els.gradeSelect.appendChild(opt);
  });
  els.gradeSelect.value = GRADE5_LIST[0];
  onTypeChange();
  onClear(false);
  refreshEntries();
  refreshGpaArea();
  startOnboarding();
}

init();
