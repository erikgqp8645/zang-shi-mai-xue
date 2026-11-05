/**
 * 病例数据 —— 与网站端 `src/api/patients.ts` 一一对应
 *
 * 服务端的接口形状不变，小程序只是换了个传输层（见 utils/api.js）。
 * 两端读写的是**同一份数据**（同一个 users 账号），不是两套库做同步。
 */

const api = require('./api.js')

/* ------------------------------- 患者 ------------------------------- */

/** 患者列表（含就诊次数），按最近记录时间倒序 */
async function listPatients() {
  const data = await api.request({ method: 'GET', path: '/api/patients' })
  return (data && data.patients) || []
}

/** 搜索：姓名、日期标签、脉象符号（含「↑」「X」等）都能搜 */
async function searchPatients(q) {
  const data = await api.request({ method: 'GET', path: '/api/search?q=' + encodeURIComponent(q) })
  return (data && data.patients) || []
}

/** 一位患者 ＋ 其全部就诊记录 */
async function getPatient(id) {
  try {
    const data = await api.request({ method: 'GET', path: '/api/patients/' + encodeURIComponent(id) })
    return (data && data.patient) || null
  } catch (e) {
    return null
  }
}

/**
 * 整份保存：患者 ＋ 就诊记录列表
 * - 传 id：写回该患者（同 id 的就诊更新、没有的删除）
 * - 不传 id：新建
 */
async function savePatient(input) {
  const data = await api.request({ method: 'POST', path: '/api/patients', body: input })
  return data && data.patient
}

/** 重命名患者 */
async function renamePatient(id, name) {
  const data = await api.request({
    method: 'PATCH',
    path: '/api/patients/' + encodeURIComponent(id),
    body: { name },
  })
  return data && data.patient
}

/** 删除患者（连带其就诊记录） */
async function deletePatient(id) {
  return api.request({ method: 'DELETE', path: '/api/patients/' + encodeURIComponent(id) })
}

/**
 * 改患者的体例（7 脉点 / 9 行）。
 *
 * 体例是患者级属性 —— 病例详情页的记录表与录入页的表格都按它画，
 * 所以切换要**立刻落库**，两处才会一直对得上。
 * 只改体例、不动格值：7↔9 来回切，「尺浮/尺中」两行的数据仍原样留着。
 */
async function updatePatientLayout(id, layout) {
  const data = await api.request({
    method: 'PATCH',
    path: '/api/patients/' + encodeURIComponent(id),
    body: { layout },
  })
  return data && data.patient
}

/** 改一次就诊记录（日期标签／脉象值／体质／疗法／该次用药） */
async function updateVisit(id, patch) {
  const data = await api.request({
    method: 'PATCH',
    path: '/api/visits/' + encodeURIComponent(id),
    body: patch,
  })
  return data && data.visit
}

/** 删除一次就诊记录 */
async function deleteVisit(id) {
  return api.request({ method: 'DELETE', path: '/api/visits/' + encodeURIComponent(id) })
}

/* ------------------------------- 用药 ------------------------------- */

/** 某位患者的全部用药记录 */
async function listMedication(patientId) {
  const data = await api.request({
    method: 'GET',
    path: '/api/patients/' + encodeURIComponent(patientId) + '/medication',
  })
  return (data && data.medication) || []
}

/** 某一次就诊的用药记录 */
async function listVisitMedication(visitId) {
  const data = await api.request({
    method: 'GET',
    path: '/api/visits/' + encodeURIComponent(visitId) + '/medication',
  })
  return (data && data.medication) || []
}

/** 整份覆盖某位患者的用药记录 */
async function saveMedication(patientId, rows) {
  const data = await api.request({
    method: 'POST',
    path: '/api/patients/' + encodeURIComponent(patientId) + '/medication',
    body: { medications: rows },
  })
  return (data && data.medication) || []
}

/** 只覆盖某一次就诊的用药 */
async function saveVisitMedication(visitId, rows) {
  const data = await api.request({
    method: 'POST',
    path: '/api/visits/' + encodeURIComponent(visitId) + '/medication',
    body: { medications: rows },
  })
  return (data && data.medication) || []
}

/** 删一条用药记录 */
async function deleteMedication(id) {
  return api.request({ method: 'DELETE', path: '/api/medication/' + encodeURIComponent(id) })
}

/* ---------------------------- 自定义符号 ---------------------------- */

/** 自定义符号清单（讲义固定符号之外的，使用者自建） */
async function listCustomSymbols() {
  const data = await api.request({ method: 'GET', path: '/api/symbols' })
  return (data && data.symbols) || []
}

/** 新增（或改名）一个自定义符号 */
async function saveCustomSymbol(symbol) {
  const data = await api.request({
    method: 'POST',
    path: '/api/symbols',
    body: { code: symbol.code, name: symbol.name },
  })
  return data && data.symbol
}

/** 删除一个自定义符号（已录入的历史符号不受影响） */
async function deleteCustomSymbol(code) {
  return api.request({ method: 'DELETE', path: '/api/symbols/' + encodeURIComponent(code) })
}

/* ------------------------------ 健康检查 ------------------------------ */

/** 服务端状态：{ ok, mode }；mode='single' 表示单机模式（不用登录） */
async function health() {
  return api.request({ method: 'GET', path: '/api/health' })
}

module.exports = {
  listPatients,
  searchPatients,
  getPatient,
  savePatient,
  renamePatient,
  updatePatientLayout,
  deletePatient,
  updateVisit,
  deleteVisit,
  listMedication,
  listVisitMedication,
  saveMedication,
  saveVisitMedication,
  deleteMedication,
  listCustomSymbols,
  saveCustomSymbol,
  deleteCustomSymbol,
  health,
}
