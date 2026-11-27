/* App de gestión — Compras: ecocardiogramas ambulatorios solicitados por Trabajo Social.
   Los datos de pacientes se piden al servidor en cada sesión y viven solo en memoria:
   no se guardan en el dispositivo. Lo único que se recuerda es la sesión (12 horas). */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const $app = document.getElementById('app');
  const $capas = document.getElementById('capas');
  const LLAVE_TOKEN = 'cardio_compras_gestion_sesion';
  const DIAS_INICIALES = 60;
  const NOMBRE_SERVICIO = CFG.NOMBRE_SERVICIO || 'Servicio de Cardiología';
  const INDICACIONES_CITA = String(CFG.INDICACIONES_CITA || '').trim();

  const ESTUDIO = 'Ecocardiograma';
  const OTRO = 'Otro';
  const OTRO_TEXTO = 'Otro (introducir manualmente)';
  const SEXOS = ['Femenino', 'Masculino'];
  const ROLES = { admin: 'Administrador', ts: 'Trabajo Social', medico: 'Médico' };
  const NO_ACUDIRA = 'No podrá acudir';
  const NO_ACUDIO = 'Paciente no acudió';
  const TIPO_SOBRECUPO = 'SOBRECUPO';
  const TIPO_EXTRA = 'EXTRACURRICULAR';
  const ORIGENES = { FORMULARIO: 'Formulario de Trabajo Social', MANUAL: 'Registro manual' };
  const GRUPOS_EDAD = [['Menos de 1 año', 0, 0], ['1 – 9', 1, 9], ['10 – 19', 10, 19], ['20 – 29', 20, 29], ['30 – 39', 30, 39], ['40 – 49', 40, 49],
    ['50 – 59', 50, 59], ['60 – 69', 60, 69], ['70 – 79', 70, 79], ['80 o más', 80, 200]];
  const LETRAS_DIA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const DIA_CORTO = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MAX_ARCHIVO = 8 * 1024 * 1024;

  const S = {
    token: '', usuario: null, medicos: [], nombresMedicos: {}, motivos: [], hospitales: [], config: null, hoy: '', filas: new Map(), repetidas: new Set(),
    desde: '', sincronizado: '', cargando: false, errorCarga: '', ui: {}, archivos: new Map(), cupos: null, stats: null, usuarios: null,
    panel: null, detalleAbierto: null, plantillas: [], estadoReportes: null, registro: null
  };

  /* ============================== utilidades ============================== */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) agregar(el, arguments[i]);
    return el;
  }
  function agregar(el, hijo) {
    if (hijo === null || hijo === undefined || hijo === false) return;
    if (Array.isArray(hijo)) hijo.forEach(function (x) { agregar(el, x); });
    else el.appendChild(hijo.nodeType ? hijo : document.createTextNode(String(hijo)));
  }
  /** <select> con opciones [valor, texto] o grupos {grupo, opciones}. */
  function selector(opciones, valor, attrs) {
    const s = h('select', attrs);
    const op = function (o) { return h('option', { value: o[0], selected: String(o[0]) === String(valor) }, o[1]); };
    opciones.forEach(function (o) {
      if (o.grupo) s.appendChild(h('optgroup', { label: o.grupo }, o.opciones.map(op))); else s.appendChild(op(o));
    });
    return s;
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function partes(iso) { const p = String(iso || '').slice(0, 10).split('-'); return [Number(p[0]), Number(p[1]), Number(p[2])]; }
  /** 1 = lunes … 7 = domingo */
  function diaSemana(iso) { const p = partes(iso); const d = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); return d === 0 ? 7 : d; }
  function fechaLarga(iso) { const p = partes(iso); return NOMBRES_DIA[diaSemana(iso) - 1] + ' ' + p[2] + ' de ' + MESES[p[1] - 1] + ' de ' + p[0]; }
  function fechaSinAnio(iso) { const p = partes(iso); return NOMBRES_DIA[diaSemana(iso) - 1] + ' ' + p[2] + ' de ' + MESES[p[1] - 1]; }
  function fechaCorta(iso) { const p = String(iso || '').slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; }
  function fechaMedia(iso) { const p = partes(iso); return iso ? DIA_CORTO[diaSemana(iso) - 1] + ' ' + String(p[2]).padStart(2, '0') + '/' + String(p[1]).padStart(2, '0') : ''; }
  function fechaChip(iso) { const p = partes(iso); return (iso === S.hoy ? 'Hoy' : DIA_CORTO[diaSemana(iso) - 1]) + ' ' + p[2] + ' ' + MES_CORTO[p[1] - 1]; }
  function horaDe(fh) { return String(fh || '').slice(11, 16); }
  function fechaHora(fh) { return fh ? fechaCorta(fh) + ' ' + horaDe(fh) : ''; }
  function hora12(hhmm) {
    const p = String(hhmm || '').split(':');
    if (p.length < 2) return '';
    const n = Number(p[0]);
    return ((n % 12) || 12) + ':' + p[1] + (n < 12 ? ' a. m.' : ' p. m.');
  }
  function telefono(t) {
    const s = String(t || '');
    if (s.charAt(0) === '+') { const d = s.slice(1); return d.length === 11 ? '+' + d.slice(0, 3) + ' ' + d.slice(3, 7) + '-' + d.slice(7) : s; }
    const d = s.replace(/\D/g, '');
    return d.length === 8 ? d.slice(0, 4) + '-' + d.slice(4) : d;
  }
  /** "7123-4567" para El Salvador; "+504…" para otros países (mientras se escribe). */
  function formatoTelefono(valor) {
    const internacional = /^\s*\+/.test(valor);
    let d = valor.replace(/\D/g, '');
    if (internacional && !(d.slice(0, 3) === '503' && d.length === 11)) return '+' + d.slice(0, 15);
    if (d.length > 8 && d.slice(0, 3) === '503') d = d.slice(3);
    d = d.slice(0, 8);
    return d.length > 4 ? d.slice(0, 4) + '-' + d.slice(4) : d;
  }
  function sumarDias(iso, n) { const p = partes(iso); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
  function diasEntre(a, b) { const x = partes(a), y = partes(b); return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 86400000); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function hospCorto(x) { return String(x || '').replace(/^H\.N\.\s*/, '').replace(/"/g, ''); }
  function medCorto(m) { return String(m || '').replace(/^Dra?\.\s*/, ''); }
  function uuid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12); }
  function guardarToken(t) { try { if (t) localStorage.setItem(LLAVE_TOKEN, t); else localStorage.removeItem(LLAVE_TOKEN); } catch (e) { /* sin almacenamiento */ } }
  function leerToken() { try { return localStorage.getItem(LLAVE_TOKEN) || ''; } catch (e) { return ''; } }
  function esAdmin() { return !!S.usuario && S.usuario.rol === 'admin'; }
  function esGestion() { return !!S.usuario && (S.usuario.rol === 'admin' || S.usuario.rol === 'ts'); }
  function esMedico() { return !!S.usuario && S.usuario.rol === 'medico'; }
  function miMedico() { return esMedico() ? S.usuario.medico || '' : ''; }
  /** Gestión cambia cualquier solicitud; el médico, solo las agendadas con él. */
  function puedeMarcar(f) { return esGestion() || (esMedico() && !!miMedico() && f.cita_medico === miMedico()); }
  function medicosActivos() { return S.medicos.filter(function (m) { return m.activo; }).map(function (m) { return m.nombre; }); }

  async function api(action, datos) {
    if (!CFG.API_URL || /PEGAR_AQUI/.test(CFG.API_URL)) {
      const e0 = new Error('La app aún no está conectada. Falta pegar la dirección de la API en el archivo config.js.');
      e0.code = 'CONFIG';
      throw e0;
    }
    let res, j;
    try {
      res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action, token: S.token }, datos || {})) });
      j = await res.json();
    } catch (e) {
      const e1 = new Error('No hay conexión con el servidor. Revise su internet e intente de nuevo.');
      e1.code = 'RED';
      throw e1;
    }
    if (!j.ok) {
      const e2 = new Error(j.error || 'Ocurrió un error.');
      e2.code = j.code;
      e2.datos = j.datos;
      if (j.code === 'SESION' && S.token) { cerrarSesion(j.error); }
      if (j.code === 'CAMBIAR_CLAVE' && S.usuario) { S.usuario.debe_cambiar = true; pintar(); }
      throw e2;
    }
    return j.data;
  }

  /* ============================== avisos y modales ============================== */
  let tostadaActual = null;
  function tostada(texto, opciones) {
    const o = opciones || {};
    if (tostadaActual) tostadaActual.remove();
    const t = h('div', { class: 'tostada' + (o.error ? ' error' : ''), role: 'status' }, h('span', null, texto),
      o.accion ? h('button', { onclick: function () { t.remove(); o.accion.fn(); } }, o.accion.texto) : null);
    document.body.appendChild(t);
    tostadaActual = t;
    setTimeout(function () { t.remove(); }, o.accion ? 9000 : 4500);
  }
  function modalesAbiertos() { return $capas.children.length > 0; }
  function abrirModal(contenido, opciones) {
    const o = opciones || {};
    const velo = h('div', { class: 'velo', role: 'dialog', 'aria-modal': 'true' });
    let cerrado = false, preguntando = false;
    const cerrarYa = function () {
      if (cerrado) return;
      cerrado = true;
      velo.remove(); document.removeEventListener('keydown', tecla); if (!modalesAbiertos()) document.body.style.overflow = ''; if (o.alCerrar) o.alCerrar();
    };
    // o.antesDeCerrar() puede devolver false (o una promesa) para que el modal siga abierto, p. ej. con un comentario sin guardar.
    const cerrar = function () {
      if (!o.antesDeCerrar) { cerrarYa(); return; }
      if (preguntando || cerrado) return;
      preguntando = true;
      Promise.resolve(o.antesDeCerrar()).then(function (ok) { preguntando = false; if (ok) cerrarYa(); });
    };
    const tecla = function (ev) { if (ev.key === 'Escape' && $capas.lastChild === velo && !document.querySelector('.visor')) cerrar(); };
    velo.addEventListener('mousedown', function (ev) { if (ev.target === velo) cerrar(); });
    document.addEventListener('keydown', tecla);
    velo.appendChild(typeof contenido === 'function' ? contenido(cerrar) : contenido);
    $capas.appendChild(velo);
    document.body.style.overflow = 'hidden';
    const foco = velo.querySelector('[data-foco]') || velo.querySelector('button, input, select');
    if (foco) foco.focus();
    return cerrar;
  }
  function modalChico(titulo, cuerpo) {
    return abrirModal(function (cerrar) {
      return h('div', { class: 'modal chico' },
        h('div', { class: 'modal-cab' }, h('h2', { style: 'margin:0' }, titulo), h('button', { class: 'btn chico x', onclick: cerrar, 'aria-label': 'Cerrar' }, '✕')),
        h('div', { class: 'modal-cuerpo' }, cuerpo(cerrar)));
    });
  }
  /** Pregunta con dos botones. Devuelve una promesa con true (confirmar) o false. */
  function preguntar(titulo, texto, siTexto, noTexto, claseSi) {
    return new Promise(function (resolver) {
      let respondido = false;
      const fin = function (v, cerrar) { if (respondido) return; respondido = true; cerrar(); resolver(v); };
      abrirModal(function (cerrar) {
        return h('div', { class: 'modal chico' },
          h('div', { class: 'modal-cab' }, h('h2', { style: 'margin:0' }, titulo)),
          h('div', { class: 'modal-cuerpo' }, agregarTexto(texto),
            h('div', { style: 'display:grid;gap:10px;margin-top:16px' },
              h('button', { class: 'btn ' + (claseSi || 'primario'), onclick: function () { fin(true, cerrar); } }, siTexto),
              h('button', { class: 'btn', 'data-foco': true, onclick: function () { fin(false, cerrar); } }, noTexto))));
      }, { alCerrar: function () { if (!respondido) { respondido = true; resolver(false); } } });
    });
  }
  function agregarTexto(t) { return (Array.isArray(t) ? t : [t]).map(function (x) { return typeof x === 'string' ? h('p', { style: 'margin:0 0 10px' }, x) : x; }); }
  function cajaError() { return h('div', { role: 'alert' }); }
  function mostrarError(caja, e) { caja.textContent = ''; caja.appendChild(h('div', { class: 'aviso error' }, e.message || String(e))); }
  async function conBoton(btn, fn) {
    const texto = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Un momento…';
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = texto; }
  }

  /* ============================== sesión ============================== */
  function cerrarSesion(mensaje) {
    S.token = '';
    S.usuario = null;
    S.filas = new Map();
    S.archivos.forEach(function (a) { URL.revokeObjectURL(a.url); });
    S.archivos = new Map();
    S.cupos = S.stats = S.usuarios = S.panel = S.estadoReportes = S.registro = null;
    S.plantillas = [];
    S.ui = {};
    S.sincronizado = '';
    S.desde = '';
    guardarToken('');
    $capas.textContent = '';
    document.body.style.overflow = '';
    pintarAcceso(mensaje);
  }

  function pintarAcceso(mensaje) {
    $app.textContent = '';
    const err = cajaError();
    const usuario = h('input', { id: 'in-usuario', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
    const clave = h('input', { id: 'in-clave', type: 'password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn primario ancho', type: 'submit' }, 'Ingresar');
    $app.appendChild(h('div', { class: 'acceso' }, h('form', { class: 'caja', onsubmit: async function (ev) {
      ev.preventDefault();
      err.textContent = '';
      try {
        const r = await conBoton(btn, function () { return api('login', { usuario: usuario.value, clave: clave.value }); });
        S.token = r.token;
        S.usuario = r.usuario;
        guardarToken(r.token);
        await iniciar();
      } catch (e) { mostrarError(err, e); }
    } },
      h('img', { src: 'icons/icon-192.png', alt: '' }),
      h('h1', null, 'Compras · Ecocardiogramas'),
      h('p', { class: 'sub' }, 'Citas, agenda y censo de estudios ambulatorios'),
      mensaje ? h('div', { class: 'aviso alerta' }, mensaje) : null,
      h('div', { class: 'campo' }, h('label', { for: 'in-usuario' }, 'Usuario'), usuario),
      h('div', { class: 'campo' }, h('label', { for: 'in-clave' }, 'Contraseña'), clave),
      err, btn,
      h('p', { style: 'color:#51606f;font-size:12.5px;text-align:center;margin:14px 0 0' }, 'Acceso exclusivo del personal autorizado. Toda acción queda registrada.'))));
    usuario.focus();
  }

  function formularioClave(alTerminar, obligado) {
    const err = cajaError();
    const actual = h('input', { id: 'cl-actual', type: 'password', autocomplete: 'current-password' });
    const nueva = h('input', { id: 'cl-nueva', type: 'password', autocomplete: 'new-password' });
    const repite = h('input', { id: 'cl-repite', type: 'password', autocomplete: 'new-password' });
    const btn = h('button', { class: 'btn primario ancho', type: 'submit' }, 'Guardar contraseña');
    return h('form', { onsubmit: async function (ev) {
      ev.preventDefault();
      err.textContent = '';
      if (nueva.value !== repite.value) { mostrarError(err, new Error('Las contraseñas nuevas no coinciden.')); return; }
      try {
        await conBoton(btn, function () { return api('clave.cambiar', { actual: actual.value, nueva: nueva.value }); });
        S.usuario.debe_cambiar = false;
        tostada('Contraseña actualizada.');
        alTerminar();
      } catch (e) { mostrarError(err, e); }
    } },
      obligado ? h('div', { class: 'aviso info' }, 'Por seguridad, debe crear su propia contraseña antes de continuar.') : null,
      h('div', { class: 'campo' }, h('label', { for: 'cl-actual' }, obligado ? 'Contraseña temporal' : 'Contraseña actual'), actual),
      h('div', { class: 'campo' }, h('label', { for: 'cl-nueva' }, 'Contraseña nueva (mínimo 8 caracteres)'), nueva),
      h('div', { class: 'campo' }, h('label', { for: 'cl-repite' }, 'Repita la contraseña nueva'), repite),
      err, btn);
  }

  function menuCuenta() {
    modalChico(S.usuario.nombre, function (cerrar) {
      return [h('p', { style: 'margin:0 0 14px;color:#51606f' }, 'Usuario: ' + S.usuario.usuario + ' · ' + ROLES[S.usuario.rol] + (miMedico() ? ' (' + miMedico() + ')' : '')),
        h('div', { style: 'display:grid;gap:10px' },
          h('button', { class: 'btn', onclick: function () { cerrar(); modalChico('Cambiar contraseña', function (c2) { return formularioClave(c2, false); }); } }, 'Cambiar contraseña'),
          h('button', { class: 'btn peligro', onclick: function () { cerrarSesion('Sesión cerrada.'); } }, 'Cerrar sesión'))];
    });
  }

  /* ============================== datos ============================== */
  function aObjeto(cols, arr) {
    const o = {};
    cols.forEach(function (c, i) { o[c] = arr[i] === undefined ? '' : arr[i]; });
    o.edadN = o.edad === '' ? -1 : Number(o.edad);
    o.busca = norm(o.nombre + ' ' + o.expediente + ' ' + o.hospital + ' ' + o.id + ' ' + o.ts_nombre);
    return o;
  }
  function integrarFila(cols, arr) { const o = aObjeto(cols, arr); S.filas.set(o.id, o); return o; }
  /** Marca como "posible repetida" el mismo paciente (hospital + expediente) solicitado en menos de 15 días. */
  function recalcularRepetidas() {
    const grupos = {};
    S.filas.forEach(function (f) {
      if (!f.expediente) return;
      const k = norm(f.hospital) + '|' + norm(f.expediente).replace(/\s/g, '');
      (grupos[k] = grupos[k] || []).push(f);
    });
    S.repetidas = new Set();
    Object.keys(grupos).forEach(function (k) {
      const g = grupos[k];
      if (g.length < 2) return;
      g.sort(function (a, b) { return cmp(a.fecha, b.fecha); });
      for (let i = 1; i < g.length; i++) {
        if (diasEntre(g[i - 1].fecha, g[i].fecha) <= 14) { S.repetidas.add(g[i - 1].id); S.repetidas.add(g[i].id); }
      }
    });
  }
  function integrar(r) {
    r.filas.forEach(function (arr) { integrarFila(r.columnas, arr); });
    S.hoy = r.fecha;
    recalcularRepetidas();
  }
  /** Aplica la fila que devuelve el servidor después de un cambio. */
  function aplicarFila(r) {
    const o = integrarFila(r.columnas, r.fila);
    recalcularRepetidas();
    return o;
  }
  async function aplicarInicio() {
    const r = await api('inicio');
    S.usuario = r.usuario;
    S.medicos = r.medicos;
    S.nombresMedicos = r.nombres_medicos || {};
    S.motivos = r.motivos_no;
    S.hospitales = r.hospitales || [];
    S.config = r.config;
    S.hoy = r.fecha;
    S.plantillas = r.plantillas || [];
    return r;
  }
  /** Trae del servidor los últimos días y todos los pendientes. Lo más antiguo ya cargado se conserva. */
  async function sincronizar(silencioso) {
    if (S.cargando || !S.token) return;
    S.cargando = true;
    if (!silencioso) pintar();
    try {
      const ventana = sumarDias(S.hoy || new Date().toISOString().slice(0, 10), -DIAS_INICIALES);
      const r = await Promise.all([aplicarInicio(), api('solicitudes.listar', { desde: ventana, hasta: '9999-12-31', pendientes: true })]);
      const recibidos = new Set(r[1].filas.map(function (arr) { return arr[0]; }));
      const antiguas = new Map();
      let cambioAntiguo = false;
      S.filas.forEach(function (f, id) {
        if (f.fecha >= ventana) return;
        if (f.estado === 'PENDIENTE' && !recibidos.has(id)) cambioAntiguo = true;
        antiguas.set(id, f);
      });
      S.filas = antiguas;
      integrar(r[1]);
      if (cambioAntiguo && S.desde) integrar(await api('solicitudes.listar', { desde: S.desde, hasta: sumarDias(ventana, -1) }));
      if (!S.desde || ventana < S.desde) S.desde = ventana;
      S.sincronizado = r[1].hora;
      S.errorCarga = '';
    } catch (e) {
      if (e.code !== 'SESION') S.errorCarga = e.message;
    }
    S.cargando = false;
    if (S.token && !(silencioso && (modalesAbiertos() || escribiendo()))) pintar();
  }
  function escribiendo() {
    const a = document.activeElement;
    return a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && $app.contains(a);
  }
  async function cargarAntiguos(desde) {
    if (S.desde && desde >= S.desde) return;
    const r = await api('solicitudes.listar', { desde: desde, hasta: S.desde ? sumarDias(S.desde, -1) : '9999-12-31' });
    integrar(r);
    S.desde = desde;
  }
  async function iniciar() {
    try {
      await aplicarInicio();
    } catch (e) {
      if (e.code !== 'SESION') pintarAcceso(e.message);
      return;
    }
    if (S.usuario.debe_cambiar) { pintar(); return; }
    pintar();
    await sincronizar();
  }
  function filasArr() { return Array.from(S.filas.values()); }

  /* ============================== cupos por médico ============================== */
  /** Cupos de un médico en una fecha: los de su día de la semana, salvo que la fecha esté marcada sin cupos. */
  function cuposDia(fecha, medico) {
    const c = S.config;
    const vacio = { cupos: 0, cerrado: false, motivo: '', hora: (c && c.hora_inicial) || '07:00' };
    if (!c || !fecha || !medico) return vacio;
    const fila = c.semana.filter(function (s) { return s.dia === diaSemana(fecha) && s.medico === medico && s.activo; })[0];
    const hora = fila ? fila.hora : vacio.hora;
    const cierre = c.sin_cupo.filter(function (s) { return s.fecha === fecha && (s.medico === 'TODOS' || s.medico === medico); })[0];
    if (cierre) return { cupos: 0, cerrado: true, motivo: cierre.motivo, hora: hora };
    return { cupos: fila ? fila.cupos : 0, cerrado: false, motivo: '', hora: hora };
  }
  /** Una cita ocupa cupo mientras está pendiente, si se realizó o si el paciente no se presentó. */
  function ocupa(f) {
    return !!f.cita_fecha && (f.estado === 'PENDIENTE' || f.estado === 'REALIZADO' || (f.estado === 'NO REALIZADO' && f.motivo_no === NO_ACUDIO));
  }
  function citasDe(fecha) { return filasArr().filter(function (f) { return f.cita_fecha === fecha; }); }
  function usados(fecha, medico, excluirId) {
    let n = 0;
    S.filas.forEach(function (f) { if (f.cita_fecha === fecha && f.cita_medico === medico && f.id !== excluirId && ocupa(f)) n++; });
    return n;
  }
  /** Médicos de un día: los que tienen turno ese día de la semana y los que tienen citas (extracurriculares). */
  function medicosDelDia(fecha) {
    const c = S.config;
    const nombres = [];
    if (c) c.semana.forEach(function (s) { if (s.dia === diaSemana(fecha) && s.activo && s.cupos > 0 && nombres.indexOf(s.medico) < 0) nombres.push(s.medico); });
    filasArr().forEach(function (f) { if (f.cita_fecha === fecha && f.cita_medico && ocupa(f) && nombres.indexOf(f.cita_medico) < 0) nombres.push(f.cita_medico); });
    return nombres.map(function (m) {
      const k = cuposDia(fecha, m), n = usados(fecha, m);
      return { medico: m, cupos: k.cupos, usados: n, hora: k.hora, cerrado: k.cerrado, motivo: k.motivo, libres: Math.max(0, k.cupos - n) };
    });
  }
  /** Resumen de un día (de todos los médicos o de uno). clase: libre | lleno | sin */
  function resumenDia(fecha, medico) {
    const det = medicosDelDia(fecha).filter(function (x) { return !medico || x.medico === medico; });
    let u = 0, c = 0, extra = 0, alguno = false;
    det.forEach(function (x) {
      u += x.usados; c += x.cupos;
      if (x.cupos === 0) extra += x.usados;
      if (x.usados < x.cupos) alguno = true;
    });
    const clase = c === 0 ? 'sin' : alguno ? 'libre' : 'lleno';
    return { usados: u, cupos: c, extra: extra, clase: clase, det: det };
  }
  /** Próximos días con cupo libre: [{fecha, medico, libres, hora}] */
  function proximasLibres(desde, cuantas, medico) {
    const out = [];
    for (let i = 0; i < 70 && out.length < cuantas; i++) {
      const d = sumarDias(desde, i);
      medicosDelDia(d).forEach(function (x) {
        if (out.length < cuantas && x.libres > 0 && (!medico || x.medico === medico)) out.push({ fecha: d, medico: x.medico, libres: x.libres, hora: x.hora });
      });
    }
    return out;
  }
  function chipTipo(f) {
    if (f.tipo_cupo === TIPO_EXTRA) return h('span', { class: 'chip extra', title: 'El médico no tenía cupos ese día' }, 'Extracurricular');
    if (f.tipo_cupo === TIPO_SOBRECUPO) return h('span', { class: 'chip sobre', title: 'Se agendó con los cupos del médico llenos' }, 'Sobrecupo');
    return null;
  }

  /* ============================== marco general ============================== */
  function barra(titulo, sub, conVolver) {
    return h('header', { class: 'barra' }, h('div', { class: 'barra-int' },
      conVolver ? h('a', { class: 'btn-barra', href: '#/' }, '‹ Inicio') : h('img', { class: 'logo', src: 'icons/icon-192.png', alt: '' }),
      h('h1', null, titulo, sub ? h('small', null, sub) : null),
      h('button', { class: 'btn-barra no-imprimir', title: 'Actualizar datos', onclick: function () { S.cupos = S.stats = S.usuarios = S.estadoReportes = null; sincronizar(); } }, '↻', h('span', { class: 'txt' }, S.cargando ? ' Actualizando…' : ' Actualizar')),
      h('button', { class: 'btn-barra no-imprimir', onclick: menuCuenta, 'aria-label': 'Mi cuenta' }, S.usuario ? S.usuario.usuario : '')));
  }
  function ruta() { return location.hash.replace(/^#\/?/, '').split('/'); }

  function pintar() {
    if (!S.token || !S.usuario) { pintarAcceso(); return; }
    const y = window.scrollY;
    const activo = document.activeElement && $app.contains(document.activeElement) ? document.activeElement : null;
    const foco = activo && activo.id ? { id: activo.id, pos: activo.tagName === 'INPUT' && /^(text|search)$/.test(activo.type) ? activo.selectionStart : null } : null;
    $app.textContent = '';
    if (S.usuario.debe_cambiar) {
      $app.appendChild(h('div', { class: 'acceso' }, h('div', { class: 'caja' }, h('h1', { style: 'margin-bottom:14px' }, 'Cree su contraseña'),
        formularioClave(function () { iniciar(); }, true))));
      return;
    }
    const r = ruta();
    const main = h('main', { class: 'contenido' });
    let titulo = 'Compras · Ecocardiogramas', sub = S.hoy ? fechaLarga(S.hoy) : '', volver = true;
    if (S.errorCarga) main.appendChild(h('div', { class: 'aviso error', role: 'alert' }, S.errorCarga));
    if (r[0] === 'citas' && esGestion()) { titulo = 'Asignación de citas'; vistaCitas(main); }
    else if (r[0] === 'registro' && esGestion()) { titulo = 'Registro manual'; sub = 'Solicitud de ecocardiograma'; vistaRegistro(main); }
    else if (r[0] === 'agenda') { titulo = esMedico() ? 'Mi agenda' : 'Agenda'; sub = esMedico() ? miMedico() : sub; vistaAgenda(main, /^\d{4}-\d{2}-\d{2}$/.test(r[1] || '') ? r[1] : S.hoy); }
    else if (r[0] === 'censo') { titulo = 'Censo'; sub = 'Todas las solicitudes'; vistaCenso(main); }
    else if (r[0] === 'estadisticas') { titulo = 'Estadísticas'; sub = ''; vistaEstadisticas(main); }
    else if (r[0] === 'censos-compra') { titulo = 'Censos de compra de servicios'; sub = esMedico() ? miMedico() : 'Formato del Ministerio, por día'; vistaCensosCompra(main); }
    else if (r[0] === 'cupos') { titulo = 'Control de cupos'; vistaCupos(main); }
    else if (r[0] === 'admin' && esAdmin()) { titulo = 'Usuarios y médicos'; sub = ''; vistaAdmin(main); }
    else { volver = false; vistaInicio(main); }
    $app.appendChild(barra(titulo, sub, volver));
    $app.appendChild(main);
    window.scrollTo(0, y);
    if (foco) {
      const el = document.getElementById(foco.id);
      if (el) { el.focus({ preventScroll: true }); if (foco.pos !== null) { try { el.setSelectionRange(foco.pos, foco.pos); } catch (e) { /* no aplica */ } } }
    }
  }

  /* ============================== inicio ============================== */
  function vistaInicio(main) {
    const todas = filasArr();
    const pend = todas.filter(function (f) { return f.estado === 'PENDIENTE'; });
    const sinCita = pend.filter(function (f) { return !f.cita_fecha; });
    const conCita = pend.filter(function (f) { return f.cita_fecha; });
    const sinNotificar = conCita.filter(function (f) { return !f.notificado && f.cita_fecha >= S.hoy; }).length;
    const mias = function (f) { return !esMedico() || f.cita_medico === miMedico(); };
    const deHoy = todas.filter(function (f) { return f.cita_fecha === S.hoy && f.motivo_no !== NO_ACUDIRA && mias(f); });
    const atendidas = deHoy.filter(function (f) { return f.estado !== 'PENDIENTE'; }).length;
    const recibidasHoy = todas.filter(function (f) { return f.fecha === S.hoy; }).length;
    const vencidas = pend.filter(function (f) { return f.cita_fecha && f.cita_fecha < S.hoy && mias(f); }).length;
    const porRevisar = todas.filter(function (f) { return f.reporte_estado === 'POR REVISAR' && mias(f); }).length;
    const sinDatos = !S.sincronizado;
    const tarjeta = function (href, clase, nombre, cifra, cifraNota, nota) {
      return h('a', { class: 'modulo ' + clase, href: href }, h('div', { class: 'nombre' }, nombre),
        cifra !== null ? h('div', { class: 'cifra' }, sinDatos ? '–' : cifra, h('small', null, cifraNota)) : null,
        nota ? h('div', { class: 'nota' }, sinDatos ? '' : nota) : null);
    };
    let proxima = '';
    if (esMedico() && miMedico()) {
      const futuras = todas.filter(function (f) { return f.cita_medico === miMedico() && f.cita_fecha > S.hoy && ocupa(f); }).map(function (f) { return f.cita_fecha; }).sort();
      if (futuras.length) proxima = 'Próxima agenda: ' + fechaSinAnio(futuras[0]) + ' (' + plural(futuras.filter(function (d) { return d === futuras[0]; }).length, 'cita', 'citas') + ')';
    }
    agregar(main, [
      h('div', { class: 'saludo' }, h('h2', null, 'Hola, ' + S.usuario.nombre),
        h('span', null, S.sincronizado ? plural(recibidasHoy, 'solicitud recibida', 'solicitudes recibidas') + ' hoy · actualizado a las ' + S.sincronizado : 'Cargando solicitudes…')),
      esMedico() && !miMedico() ? h('div', { class: 'aviso alerta' }, 'Su usuario no está vinculado a ningún médico de la lista, así que no tiene agenda. Pida al administrador que lo vincule en "Usuarios y médicos".') : null,
      porRevisar ? h('a', { class: 'aviso alerta aviso-enlace', href: '#/censo', onclick: function () {
        const u = uiCenso();
        Object.assign(u, { reporte: 'revisar', q: '', hosp: '', estado: '', medico: '', origen: '', desde: S.desde || u.desde, hasta: S.hoy });
      } }, h('b', null, plural(porRevisar, 'reporte por revisar', 'reportes por revisar') + '.'),
        ' Se encontraron reportes que podrían corresponder a estas solicitudes, pero no coinciden todos los datos. Toque aquí para revisarlos.') : null,
      vencidas ? h('a', { class: 'aviso alerta aviso-enlace', href: '#/censo', onclick: function () {
        const u = uiCenso();
        Object.assign(u, { reporte: '', q: '', hosp: '', estado: 'VENCIDA', medico: miMedico(), origen: '', desde: S.desde || u.desde, hasta: S.hoy });
      } }, h('b', null, plural(vencidas, 'cita pasada sigue', 'citas pasadas siguen') + ' sin marcar.'), ' Márquelas como realizadas o "Paciente no acudió".') : null,
      h('div', { class: 'modulos' },
        esGestion() ? tarjeta('#/citas', 'principal', 'Asignación de citas', sinCita.length, 'por agendar',
          plural(conCita.length, 'agendada', 'agendadas') + ' en espera · ' + plural(sinNotificar, 'sin notificar', 'sin notificar')) : null,
        esGestion() ? tarjeta('#/registro', '', 'Registro manual', null, '', 'Registrar una solicitud y agendarla de una vez o después') : null,
        tarjeta('#/agenda', esMedico() ? 'principal' : '', esMedico() ? 'Mi agenda de hoy' : 'Agenda de hoy', deHoy.length, deHoy.length === 1 ? 'cita hoy' : 'citas hoy',
          (atendidas + ' marcadas · ' + (deHoy.length - atendidas) + ' por marcar') + (proxima ? ' · ' + proxima : ''))),
      h('h3', { class: 'seccion-t' }, 'Gestión'),
      h('div', { class: 'modulos' },
        tarjeta('#/censo', 'util', 'Censo', null, '', 'Todas las solicitudes, con filtros y descarga'),
        tarjeta('#/censos-compra', 'util', 'Censos de compra de servicios', null, '', esMedico() ? 'Sus estudios realizados por día, en el formato del Ministerio (Word)' : 'Estudios realizados por día y médico, en el formato del Ministerio (Word)'),
        tarjeta('#/estadisticas', 'util', 'Estadísticas', null, '', 'Por médico, hospital, edad, sexo, origen y ocupación de cupos'),
        tarjeta('#/cupos', 'util', 'Control de cupos', null, '', esGestion() ? 'Cupos por día y médico, fechas sin cupos y formulario' : 'Consulta de cupos por día y médico'),
        esAdmin() ? tarjeta('#/admin', 'util', 'Usuarios y médicos', null, '', 'Cuentas de acceso, médicos, plantillas y censo de reportes') : null)
    ]);
  }

  /* ============================== tablas ============================== */
  const ORDENES = {
    fecha: ['Fecha de solicitud', function (a, b) { return cmp(a.fecha_hora, b.fecha_hora); }],
    cita: ['Fecha de cita', function (a, b) { return cmp(a.cita_fecha || '9999', b.cita_fecha || '9999') || cmp(a.cita_hora, b.cita_hora) || cmp(a.fecha_hora, b.fecha_hora); }],
    hora: ['Hora', function (a, b) { return cmp(a.cita_hora, b.cita_hora) || cmp(a.cita_medico, b.cita_medico) || a.nombre.localeCompare(b.nombre, 'es'); }],
    nombre: ['Nombre', function (a, b) { return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }); }],
    edad: ['Edad', function (a, b) { return a.edadN - b.edadN || cmp(a.fecha_hora, b.fecha_hora); }],
    hospital: ['Hospital', function (a, b) { return hospCorto(a.hospital).localeCompare(hospCorto(b.hospital), 'es') || cmp(a.fecha_hora, b.fecha_hora); }],
    medico: ['Médico', function (a, b) { return cmp(a.cita_medico || 'zz', b.cita_medico || 'zz') || cmp(a.cita_fecha, b.cita_fecha) || cmp(a.cita_hora, b.cita_hora); }]
  };
  function ui(llave, base) { if (!S.ui[llave]) S.ui[llave] = Object.assign({ q: '', limite: 150 }, base); return S.ui[llave]; }

  function controles(u, ordenes, extra) {
    const buscar = h('input', { type: 'search', id: 'buscar', placeholder: 'Nombre, expediente, hospital o Trabajo Social', value: u.q,
      oninput: function (ev) { u.q = ev.target.value; u.limite = 150; clearTimeout(buscar._t); buscar._t = setTimeout(function () { pintar(); }, 180); } });
    return h('div', { class: 'filtros no-imprimir' },
      h('div', { class: 'campo buscar' }, h('label', { for: 'buscar' }, 'Buscar'), buscar),
      extra || null,
      h('div', { class: 'campo chico' }, h('label', { for: 'orden' }, 'Ordenar por'),
        selector(ordenes.map(function (k) { return [k, ORDENES[k][0]]; }), u.orden, { id: 'orden', onchange: function (ev) { u.orden = ev.target.value; pintar(); } })),
      h('div', { class: 'campo', style: 'flex:0 0 auto' }, h('label', null, ' '),
        h('button', { class: 'btn', title: 'Invertir el orden', onclick: function () { u.dir = -u.dir; pintar(); } }, u.dir > 0 ? '↑ Ascendente' : '↓ Descendente')));
  }
  function filtroSelect(id, etiqueta, opciones, valor, alCambiar) {
    return h('div', { class: 'campo chico' }, h('label', { for: id }, etiqueta),
      selector(opciones, valor, { id: id, onchange: function (ev) { alCambiar(ev.target.value); pintar(); } }));
  }
  function opcionesHospital(filas) {
    const vistos = {};
    filas.forEach(function (f) { if (f.hospital) vistos[f.hospital] = true; });
    const lista = S.hospitales.filter(function (x) { return vistos[x]; }).concat(Object.keys(vistos).filter(function (x) { return S.hospitales.indexOf(x) < 0; }).sort());
    return [['', 'Todos']].concat(lista.map(function (x) { return [x, hospCorto(x)]; }));
  }
  function opcionesMedico(conSinCita) {
    const nombres = S.medicos.map(function (m) { return m.nombre; });
    filasArr().forEach(function (f) { if (f.cita_medico && nombres.indexOf(f.cita_medico) < 0) nombres.push(f.cita_medico); });
    return [['', 'Todos']].concat(nombres.map(function (m) { return [m, m]; })).concat(conSinCita ? [['-', 'Sin cita']] : []);
  }
  function aplicar(filas, u) {
    const q = norm(u.q.trim());
    const palabras = q ? q.split(/\s+/) : [];
    const r = palabras.length ? filas.filter(function (f) { return palabras.every(function (p) { return f.busca.indexOf(p) >= 0; }); }) : filas.slice();
    r.sort(ORDENES[u.orden][1]);
    if (u.dir < 0) r.reverse();
    return r;
  }

  function selectorMarcado(f) {
    const actual = f.estado === 'REALIZADO' ? 'R|' + f.realizado_por : f.estado === 'NO REALIZADO' ? 'N|' + f.motivo_no : 'P|';
    let medicos = esMedico() ? [miMedico()] : S.medicos.filter(function (m) { return m.activo || m.nombre === f.realizado_por; }).map(function (m) { return m.nombre; });
    // El médico de la cita va primero.
    if (f.cita_medico && medicos.indexOf(f.cita_medico) > 0) medicos = [f.cita_medico].concat(medicos.filter(function (m) { return m !== f.cita_medico; }));
    medicos = medicos.map(function (m) { return ['R|' + m, m]; });
    if (f.estado === 'REALIZADO' && !medicos.some(function (m) { return m[0] === actual; })) medicos.push([actual, f.realizado_por]);
    const motivos = S.motivos.map(function (m) { return ['N|' + m, m]; });
    if (f.estado === 'NO REALIZADO' && !motivos.some(function (m) { return m[0] === actual; })) motivos.push([actual, f.motivo_no]);
    return selector([['P|', 'Pendiente'], { grupo: 'Realizado por', opciones: medicos }, { grupo: 'No se realizó', opciones: motivos }], actual,
      { class: 'marcar ' + (f.estado === 'REALIZADO' ? 'hecho' : f.estado === 'NO REALIZADO' ? 'no' : 'pend'),
        'aria-label': 'Resultado de la solicitud de ' + f.nombre,
        onclick: function (ev) { ev.stopPropagation(); },
        onchange: function (ev) { marcar(f, ev.target.value, actual, ev.target); } });
  }

  async function marcar(f, valor, anterior, control, esDeshacer) {
    const tipo = { R: 'REALIZADO', N: 'NO_REALIZADO', P: 'PENDIENTE' }[valor.charAt(0)];
    if (control) control.disabled = true;
    try {
      const r = await api('solicitudes.marcar', { id: f.id, tipo: tipo, valor: valor.slice(2) });
      f = aplicarFila(r);
      const texto = tipo === 'REALIZADO' ? 'Realizado por ' + f.realizado_por : tipo === 'NO_REALIZADO' ? 'Cerrada: ' + f.motivo_no : 'Devuelta a pendientes';
      tostada(f.nombre + ' — ' + texto, esDeshacer ? null : { accion: { texto: 'Deshacer', fn: function () { marcar(f, anterior, valor, null, true); } } });
    } catch (e) {
      tostada(e.message, { error: true });
    }
    refrescarDetalle(f.id);
    pintar();
  }

  function chipEstado(f) {
    if (f.estado === 'REALIZADO') return h('span', { class: 'chip ok' }, 'Realizado' + (f.realizado_por ? ' · ' + medCorto(f.realizado_por) : ''));
    if (f.estado === 'NO REALIZADO') return h('span', { class: 'chip gris' }, f.motivo_no || 'No realizado');
    return h('span', { class: 'chip azul' }, 'Pendiente');
  }
  function chipOrigen(f) { return f.origen === 'MANUAL' ? h('span', { class: 'chip manual', title: 'Registrada por ' + f.registrado_por }, 'Manual') : null; }
  function edadCorta(f) {
    if (f.edad === '') return '—';
    if (f.edad === '0') {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f.fecha_nacimiento || '');
      if (m) { const meses = diasEntre(m[3] + '-' + m[2] + '-' + m[1], f.fecha) / 30.44; return Math.max(0, Math.floor(meses)) + ' m'; }
      return '< 1 a';
    }
    return f.edad + ' a';
  }
  function textoEspera(f) {
    const d = diasEntre(f.fecha, S.hoy);
    return d <= 0 ? 'recibida hoy' : d === 1 ? 'hace 1 día' : 'hace ' + d + ' días';
  }
  function textoCita(f) { return f.cita_fecha ? fechaMedia(f.cita_fecha) + ' · ' + hora12(f.cita_hora) : ''; }

  function celdaCita(f) {
    if (f.estado !== 'PENDIENTE') {
      return [chipEstado(f), f.cita_fecha ? h('div', { class: 'tenue', style: 'margin-top:3px' }, 'Cita: ' + textoCita(f) + ' · ' + medCorto(f.cita_medico)) : null];
    }
    const abierta = S.panel && S.panel.id === f.id;
    const alternar = function (ev) { ev.stopPropagation(); alternarPanel(f); };
    if (!f.cita_fecha) {
      return h('button', { class: 'btn suave btn-cita', 'aria-expanded': String(abierta), onclick: alternar }, 'Asignar cita', h('span', { class: 'fl' }, abierta ? ' ▲' : ' ▼'));
    }
    const pasada = f.cita_fecha < S.hoy;
    return [h('button', { class: 'btn btn-cita', 'aria-expanded': String(abierta), onclick: alternar, style: pasada ? 'border-color:#e3b5b0' : '' },
      textoCita(f), h('span', { class: 'fl' }, abierta ? ' ▲' : ' ▼')),
    h('div', { class: 'tenue', style: 'margin-top:3px' }, f.cita_medico),
    h('div', { class: 'chips' },
      pasada ? h('span', { class: 'chip urg' }, 'Cita pasada sin marcar') : null,
      chipTipo(f),
      f.notificado ? h('span', { class: 'chip ok', title: 'Notificado: ' + f.notificado }, 'Notificado ✓') : h('span', { class: 'chip gris' }, 'Sin notificar'))];
  }
  function alternarPanel(f) {
    if (S.panel && S.panel.id === f.id) S.panel = null;
    else S.panel = nuevoEstadoPanel(f);
    pintar();
  }
  function nuevoEstadoPanel(f) {
    return { id: f.id, modo: f.cita_fecha ? 'opciones' : 'asignar', fecha: '', hora: '', medico: '' };
  }

  const COLS = {
    cita: { t: 'Cita', clase: 'c-cita', celda: celdaCita },
    marcar: { t: 'Realizado por · reporte', clase: 'c-marcar', celda: celdaMarcar },
    solicitud: { t: 'Solicitud', orden: 'fecha', clase: 'nowrap', e: 'Solicitud', celda: function (f) {
      return [fechaHora(f.fecha_hora), f.estado === 'PENDIENTE' ? h('div', { class: 'tenue' }, textoEspera(f)) : null];
    } },
    hora: { t: 'Hora', orden: 'hora', clase: 'nowrap', e: 'Hora', celda: function (f) { return h('b', null, hora12(f.cita_hora)); } },
    paciente: { t: 'Paciente', orden: 'nombre', clase: 'c-pac pac', celda: function (f) {
      return [h('b', null, f.nombre), h('span', { class: 'tenue' }, 'Exp. ' + (f.expediente || 's/d') + ' · ' + f.id),
        S.repetidas.has(f.id) ? h('span', { class: 'chip rep', style: 'margin-left:6px', title: 'Mismo paciente y hospital con menos de 15 días de diferencia' }, 'Posible repetida') : null];
    } },
    edad: { t: 'Edad · sexo', orden: 'edad', clase: 'nowrap', e: 'Edad', celda: function (f) { return edadCorta(f) + (f.sexo ? ' · ' + f.sexo.charAt(0) : ''); } },
    hospital: { t: 'Hospital · solicita', orden: 'hospital', clase: 'c-hosp', celda: function (f) {
      return [h('div', null, hospCorto(f.hospital)), h('span', { class: 'tenue' }, f.origen === 'MANUAL' ? 'Registro manual · ' + f.registrado_por : f.ts_nombre), ' ', chipOrigen(f)];
    } },
    telefono: { t: 'Teléfono', clase: 'nowrap', e: 'Tel.', celda: function (f) {
      return [h('div', null, telefono(f.contacto)), f.ts_contacto ? h('span', { class: 'tenue' }, 'TS ' + telefono(f.ts_contacto)) : null];
    } },
    citaTexto: { t: 'Cita', orden: 'cita', clase: 'nowrap', e: 'Cita', celda: function (f) {
      if (!f.cita_fecha) return h('span', { class: 'tenue' }, 'Sin cita');
      return [textoCita(f), h('div', { class: 'tenue' }, f.cita_medico), chipTipo(f),
        f.motivo_no === NO_ACUDIRA ? h('div', { class: 'tenue' }, 'cancelada') : null];
    } },
    medicoCita: { t: 'Médico', orden: 'medico', e: 'Médico', celda: function (f) { return [f.cita_medico || '—', ' ', chipTipo(f)]; } }
  };

  function tabla(filas, u, op) {
    const o = op || {};
    if (!filas.length) return h('div', { class: 'tabla-caja' }, h('div', { class: 'vacio' }, S.sincronizado ? (o.vacio || 'No hay solicitudes en este apartado.') : 'Cargando solicitudes…'));
    const visibles = filas.slice(0, u.limite);
    const cuerpo = h('tbody');
    visibles.forEach(function (f) {
      const plegable = o.plegable && f.estado === 'PENDIENTE';
      const abierta = plegable && S.panel && S.panel.id === f.id;
      cuerpo.appendChild(h('tr', { class: (f.estado === 'PENDIENTE' ? '' : 'cerrada') + (abierta ? ' abierta' : ''), tabindex: '0',
        onclick: function () { if (plegable) alternarPanel(f); else abrirDetalle(f); },
        onkeydown: function (ev) { if (ev.key === 'Enter' && ev.target.tagName === 'TR') { if (plegable) alternarPanel(f); else abrirDetalle(f); } } },
      o.columnas.map(function (k) { const c = COLS[k]; return h('td', { class: c.clase || null, 'data-e': c.e || null }, c.celda(f)); })));
      if (abierta) {
        cuerpo.appendChild(h('tr', { class: 'plegable' }, h('td', { colspan: String(o.columnas.length) },
          panelCita(f, S.panel, function (cerrar) { if (cerrar) S.panel = null; pintar(); }))));
      }
    });
    const col = function (k) {
      const c = COLS[k];
      const ord = c.orden && o.ordenes.indexOf(c.orden) >= 0 ? c.orden : null;
      return h('th', null, ord ? h('button', { title: 'Ordenar por ' + c.t.toLowerCase(), onclick: function () { if (u.orden === ord) u.dir = -u.dir; else { u.orden = ord; u.dir = 1; } pintar(); } },
        c.t + (u.orden === ord ? (u.dir > 0 ? ' ↑' : ' ↓') : '')) : c.t);
    };
    return h('div', { class: 'tabla-caja' },
      h('div', { class: 'tabla-scroll' }, h('table', { class: 'censo' }, h('thead', null, h('tr', null, o.columnas.map(col))), cuerpo)),
      h('div', { class: 'pie-tabla' }, h('span', null, 'Mostrando ' + visibles.length + ' de ' + plural(filas.length, 'solicitud', 'solicitudes')),
        filas.length > visibles.length ? h('button', { class: 'btn chico', onclick: function () { u.limite += 150; pintar(); } }, 'Mostrar más') : null));
  }

  /* ============================== notificación de la cita ============================== */
  function mensajeCita(f, paraPaciente) {
    return [paraPaciente ? 'Buen día. ' + NOMBRE_SERVICIO + ' le informa su cita de ecocardiograma:' : NOMBRE_SERVICIO + ' – cita de ecocardiograma',
      'Paciente: ' + f.nombre + ' (exp. ' + f.expediente + ')',
      paraPaciente ? null : 'Hospital: ' + f.hospital,
      'Fecha: ' + fechaLarga(f.cita_fecha),
      'Hora: ' + hora12(f.cita_hora),
      'Médico: ' + f.cita_medico,
      INDICACIONES_CITA || null,
      '',
      paraPaciente ? 'Si no podrá acudir, por favor avise con tiempo para dar el cupo a otro paciente.'
        : 'Favor de informar al paciente. Si no podrá acudir, avise con tiempo para reasignar el cupo.',
      'Solicitud ' + f.id].filter(function (x) { return x !== null; }).join('\n');
  }
  function numeroWa(t) {
    // Números de El Salvador: 8 dígitos (se antepone 503). De otros países: guardados con "+código".
    const s = String(t || '');
    return s.charAt(0) === '+' ? s.slice(1).replace(/\D/g, '') : /^\d{8}$/.test(s) ? '503' + s : '';
  }
  function enlaceWhatsApp(f, paraPaciente) {
    const num = numeroWa(paraPaciente ? f.contacto : f.ts_contacto);
    return num && f.cita_fecha ? 'https://wa.me/' + num + '?text=' + encodeURIComponent(mensajeCita(f, paraPaciente)) : '';
  }
  async function marcarNotificado(f, valor, silencioso) {
    try {
      const r = await api('cita.notificado', { id: f.id, valor: valor });
      aplicarFila(r);
      if (!silencioso) tostada(valor ? 'Marcada como notificada.' : 'Se quitó la marca de notificada.');
    } catch (e) { tostada(e.message, { error: true }); }
    refrescarDetalle(f.id);
    if (!modalesAbiertos() || !silencioso) pintar();
  }
  function botonWhatsApp(f, paraPaciente, texto) {
    const url = enlaceWhatsApp(f, paraPaciente);
    if (!url) return null;
    return h('a', { class: 'btn wa', href: url, target: '_blank', rel: 'noopener',
      onclick: function (ev) { ev.stopPropagation(); if (!f.notificado) marcarNotificado(f, true, true); } }, texto || 'WhatsApp');
  }
  /** A quién se avisa: Trabajo Social (solicitudes del formulario) y el paciente. */
  function bloqueNotificar(f) {
    const ts = !!f.ts_contacto;
    return h('div', { class: 'notif-bloque' },
      h('div', { class: 'linea' }, f.notificado ? ['Notificado: ', h('b', null, f.notificado)] : 'Aún no se ha notificado la cita.'),
      ts ? h('div', { class: 'quien' }, h('b', null, 'Trabajo Social: '), h('span', null, (f.ts_nombre || '') + ' · ' + telefono(f.ts_contacto))) : null,
      ts ? h('div', { class: 'botones' }, botonWhatsApp(f, false, 'WhatsApp a Trabajo Social'),
        h('a', { class: 'btn', href: 'tel:' + f.ts_contacto, onclick: function (ev) { ev.stopPropagation(); } }, 'Llamar a Trabajo Social')) : null,
      h('div', { class: 'quien' }, h('b', null, 'Paciente: '), h('span', null, telefono(f.contacto) || 'sin número')),
      h('div', { class: 'botones' }, botonWhatsApp(f, true, 'WhatsApp al paciente'),
        f.contacto ? h('a', { class: 'btn', href: 'tel:' + f.contacto, onclick: function (ev) { ev.stopPropagation(); } }, 'Llamar al paciente') : null,
        h('button', { class: 'btn', onclick: function (ev) { conBoton(ev.currentTarget, function () { return marcarNotificado(f, !f.notificado); }); } },
          f.notificado ? 'Quitar marca de notificado' : 'Marcar como notificado')));
  }

  /* ============================== elegir fecha y médico ============================== */
  /**
   * Fecha, médico y hora de una cita, con los próximos días con cupo, la ocupación del médico ese día
   * y el aviso de extracurricular. "st" guarda {fecha, medico, hora} para que sobreviva a los repintados.
   */
  function selectorCita(st, excluirId, prefijo) {
    const libres = proximasLibres(S.hoy, 8);
    const ocupacion = h('div', { class: 'ocupacion', 'aria-live': 'polite' });
    const fecha = h('input', { type: 'date', id: prefijo + '-fecha', min: S.hoy, value: st.fecha });
    const hora = h('input', { type: 'time', id: prefijo + '-hora', value: st.hora, step: 300, onchange: function (ev) { st.hora = ev.target.value; } });
    const cajaMedico = h('div', { class: 'campo' });
    const chips = h('div', { class: 'fechas-libres' });
    const pintarMedicos = function () {
      cajaMedico.textContent = '';
      const delDia = st.fecha ? medicosDelDia(st.fecha) : [];
      const conCupo = delDia.filter(function (x) { return x.cupos > 0; }).map(function (x) {
        return [x.medico, x.medico + ' — ' + x.usados + '/' + x.cupos + (x.libres ? '' : ' (lleno)')];
      });
      const otros = medicosActivos().filter(function (m) { return !conCupo.some(function (x) { return x[0] === m; }); }).map(function (m) { return [m, m + ' — sin cupos ese día']; });
      const grupos = st.fecha ? [['', 'Elija…']].concat(conCupo.length ? [{ grupo: 'Con cupos ese día', opciones: conCupo }] : [])
        .concat(otros.length ? [{ grupo: 'Extracurricular', opciones: otros }] : []) : [['', 'Elija primero la fecha']].concat(medicosActivos().map(function (m) { return [m, m]; }));
      agregar(cajaMedico, [h('label', { for: prefijo + '-medico' }, 'Médico'),
        selector(grupos, st.medico, { id: prefijo + '-medico', onchange: function (ev) { st.medico = ev.target.value; st.hora = cuposDia(st.fecha, st.medico).hora; hora.value = st.hora; actualizar(); } })]);
    };
    const pintarChips = function () {
      chips.textContent = '';
      if (!libres.length) { chips.appendChild(h('span', { class: 'linea' }, 'No hay cupos libres en los próximos días. Elija una fecha y un médico (sobrecupo o extracurricular).')); return; }
      libres.forEach(function (x) {
        chips.appendChild(h('button', { type: 'button', class: 'fecha-chip', 'aria-pressed': String(st.fecha === x.fecha && st.medico === x.medico),
          onclick: function () { st.fecha = x.fecha; st.medico = x.medico; st.hora = x.hora; fecha.value = x.fecha; hora.value = x.hora; actualizar(); } },
        fechaChip(x.fecha), h('span', { class: 'med' }, medCorto(x.medico)), h('small', null, plural(x.libres, 'libre', 'libres'))));
      });
    };
    const actualizar = function () {
      pintarChips();
      pintarMedicos();
      ocupacion.textContent = '';
      ocupacion.className = 'ocupacion';
      if (!st.fecha) { ocupacion.appendChild(document.createTextNode('Elija un día de la lista o escriba la fecha.')); return; }
      if (!st.medico) { ocupacion.appendChild(document.createTextNode('Elija el médico de la cita.')); return; }
      const k = cuposDia(st.fecha, st.medico), n = usados(st.fecha, st.medico, excluirId);
      const horas = {};
      filasArr().forEach(function (x) { if (x.id !== excluirId && x.cita_fecha === st.fecha && x.cita_medico === st.medico && ocupa(x)) horas[x.cita_hora] = (horas[x.cita_hora] || 0) + 1; });
      const lista = Object.keys(horas).sort().map(function (x) { return hora12(x) + (horas[x] > 1 ? ' (' + horas[x] + ')' : ''); });
      ocupacion.classList.add(k.cupos === 0 ? 'extra' : n >= k.cupos ? 'lleno' : 'libre');
      agregar(ocupacion, [h('b', null, st.medico + ', ' + fechaSinAnio(st.fecha) + ': '),
        k.cupos === 0 ? 'no tiene cupos ese día' + (k.motivo ? ' (' + k.motivo + ')' : '') + ' → sería paciente extracurricular' + (n ? ' · ya hay ' + plural(n, 'extracurricular', 'extracurriculares') : '')
          : n + ' de ' + k.cupos + ' cupos ocupados' + (n >= k.cupos ? ' — cupos completos' : ''),
        lista.length ? h('span', { class: 'horas' }, 'Horas ya agendadas: ' + lista.join(', ')) : null]);
    };
    fecha.addEventListener('change', function () {
      st.fecha = fecha.value;
      // Si el médico elegido no tiene cupos ese día, se propone el primero que sí tenga.
      if (st.fecha && cuposDia(st.fecha, st.medico).cupos === 0) {
        const op = medicosDelDia(st.fecha).filter(function (x) { return x.libres > 0; })[0] || medicosDelDia(st.fecha).filter(function (x) { return x.cupos > 0; })[0];
        if (op) { st.medico = op.medico; st.hora = op.hora; hora.value = op.hora; }
      }
      actualizar();
    });
    actualizar();
    return h('div', { style: 'display:grid;gap:12px' },
      h('div', null, h('div', { class: 'linea', style: 'margin-bottom:6px' }, 'Próximos días con cupo:'), chips),
      h('div', { class: 'fila' },
        h('div', { class: 'campo corto' }, h('label', { for: prefijo + '-fecha' }, 'Fecha'), fecha),
        cajaMedico,
        h('div', { class: 'campo corto' }, h('label', { for: prefijo + '-hora' }, 'Hora'), hora)),
      ocupacion);
  }

  /**
   * Revisa la cita antes de enviarla. Devuelve {sobrecupo, extracurricular} o null si la persona prefiere otra fecha.
   * Si el médico no tiene cupos ese día pregunta "está agendando paciente extracurricular"; si están llenos, ofrece sobrecupo.
   */
  async function confirmarCita(st, excluirId, datosServidor) {
    const k = datosServidor ? { cupos: datosServidor.cupos, motivo: datosServidor.motivo } : cuposDia(st.fecha, st.medico);
    const n = datosServidor ? datosServidor.usados : usados(st.fecha, st.medico, excluirId);
    if (k.cupos === 0) {
      const ok = await preguntar('Paciente extracurricular', ['Está agendando paciente extracurricular, ¿desea continuar?',
        st.medico + ' no tiene cupos el ' + fechaLarga(st.fecha) + (k.motivo ? ' (' + k.motivo + ')' : '') + '.'], 'Sí, continuar', 'No, elegir otra fecha', 'alerta');
      return ok ? { extracurricular: true, sobrecupo: false } : null;
    }
    if (n >= k.cupos) {
      const ok = await preguntar('Se alcanzó el límite de cupos', ['El ' + fechaLarga(st.fecha) + ' ' + st.medico + ' ya tiene ' + n + ' de ' + k.cupos + ' cupos ocupados.',
        '¿Desea asignar otra fecha o asignar en sobrecupo?'], 'Asignar en sobrecupo', 'Elegir otra fecha', 'alerta');
      return ok ? { extracurricular: false, sobrecupo: true } : null;
    }
    return { extracurricular: false, sobrecupo: false };
  }
  function validarSt(st) {
    if (!st.fecha) return 'Elija la fecha de la cita.';
    if (st.fecha < S.hoy) return 'La fecha ya pasó.';
    if (!st.medico) return 'Elija el médico de la cita.';
    if (!/^\d{2}:\d{2}$/.test(st.hora || '')) return 'Escriba la hora de la cita.';
    return '';
  }

  /* ============================== panel de cita (plegable) ============================== */
  /**
   * Panel para asignar, reprogramar o cancelar la cita y notificarla. "st" guarda lo que se está editando
   * para que sobreviva a los repintados. alCambiar(cerrar) se llama al terminar.
   */
  function panelCita(f, st, alCambiar) {
    const caja = h('div', { class: 'panel-cita', onclick: function (ev) { ev.stopPropagation(); } });
    if (f.estado !== 'PENDIENTE') {
      agregar(caja, [h('div', { class: 'linea' }, 'La solicitud está cerrada (', chipEstado(f), ').' + (esGestion() ? ' Para agendarla de nuevo, primero devuélvala a pendientes.' : '')),
        f.cita_fecha ? h('div', { class: 'linea' }, 'Última cita: ', h('b', null, fechaLarga(f.cita_fecha) + ' · ' + hora12(f.cita_hora) + ' · ' + f.cita_medico)) : null]);
      return caja;
    }
    if (!esGestion()) {
      agregar(caja, f.cita_fecha ? [h('h4', null, 'Cita: ' + fechaLarga(f.cita_fecha) + ' · ' + hora12(f.cita_hora), chipTipo(f)), h('div', { class: 'linea' }, f.cita_medico)]
        : h('div', { class: 'linea' }, 'Aún no tiene cita (' + textoEspera(f) + '). La asigna Trabajo Social.'));
      return caja;
    }
    if (st.modo === 'opciones' && !f.cita_fecha) {
      agregar(caja, [h('div', { class: 'linea' }, 'Esta solicitud aún no tiene cita asignada (' + textoEspera(f) + ').'),
        h('div', { class: 'botones' }, h('button', { class: 'btn primario', onclick: function () { st.modo = 'asignar'; alCambiar(false); } }, 'Asignar cita'))]);
      return caja;
    }
    if (st.modo === 'opciones') {
      const pasada = f.cita_fecha < S.hoy;
      agregar(caja, [
        h('h4', null, 'Cita: ' + fechaLarga(f.cita_fecha) + ' · ' + hora12(f.cita_hora), chipTipo(f), pasada ? h('span', { class: 'chip urg' }, 'Ya pasó: marque el resultado') : null),
        h('div', { class: 'linea' }, h('b', null, f.cita_medico), ' · ' + hospCorto(f.hospital)),
        bloqueNotificar(f),
        h('div', { class: 'botones' },
          h('button', { class: 'btn primario', onclick: function () { st.modo = 'asignar'; st.fecha = ''; st.hora = f.cita_hora; st.medico = f.cita_medico; alCambiar(false); } }, 'Reprogramar'),
          h('button', { class: 'btn peligro', onclick: function (ev) { noPodraAcudir(f, ev.currentTarget, alCambiar); } }, 'Paciente no podrá acudir'),
          h('button', { class: 'btn', onclick: function () { abrirDetalle(f); } }, 'Ver solicitud completa'))
      ]);
      return caja;
    }
    // Modo asignar / reprogramar
    const err = cajaError();
    const btn = h('button', { class: 'btn primario', onclick: function (ev) { guardarCita(f, st, ev.currentTarget, err, alCambiar); } }, f.cita_fecha ? 'Guardar nueva fecha' : 'Asignar cita');
    agregar(caja, [
      h('h4', null, (f.cita_fecha ? 'Reprogramar cita · ' : 'Asignar cita · ') + f.nombre),
      f.cita_fecha ? h('div', { class: 'linea' }, 'Cita actual: ', h('b', null, fechaLarga(f.cita_fecha) + ' · ' + hora12(f.cita_hora) + ' · ' + f.cita_medico), '. Al guardar, ese cupo queda libre.') : null,
      selectorCita(st, f.id, 'pc-' + f.id),
      err,
      h('div', { class: 'botones' }, btn,
        h('button', { class: 'btn', onclick: function () { st.modo = 'opciones'; alCambiar(!f.cita_fecha); } }, 'Cancelar'))
    ]);
    return caja;
  }

  async function guardarCita(f, st, btn, err, alCambiar, confirmado) {
    err.textContent = '';
    const problema = validarSt(st);
    if (problema) { mostrarError(err, new Error(problema)); return; }
    const conf = confirmado || await confirmarCita(st, f.id);
    if (!conf) return;
    try {
      const r = await conBoton(btn, function () {
        return api('cita.asignar', { id: f.id, fecha: st.fecha, hora: st.hora, medico: st.medico, sobrecupo: conf.sobrecupo, extracurricular: conf.extracurricular });
      });
      const reprogramada = !!f.cita_fecha;
      f = aplicarFila(r);
      st.modo = 'opciones';
      const url = enlaceWhatsApp(f, !f.ts_contacto);
      tostada((reprogramada ? 'Cita reprogramada: ' : 'Cita asignada: ') + f.nombre + ', ' + textoCita(f) + ' · ' + f.cita_medico + (f.tipo_cupo ? ' (' + f.tipo_cupo.toLowerCase() + ')' : ''),
        url ? { accion: { texto: f.ts_contacto ? 'WhatsApp a Trabajo Social' : 'WhatsApp al paciente', fn: function () { window.open(url, '_blank', 'noopener'); marcarNotificado(f, true, true); } } } : null);
      refrescarDetalle(f.id);
      alCambiar(false);
    } catch (e) {
      if ((e.code === 'SIN_CUPO' || e.code === 'EXTRACURRICULAR') && e.datos) {
        // Otra persona ocupó el último cupo (o cambió la agenda) mientras tanto.
        const c2 = await confirmarCita(st, f.id, e.datos);
        if (c2) guardarCita(f, st, btn, err, alCambiar, c2);
        return;
      }
      mostrarError(err, e);
    }
  }
  async function noPodraAcudir(f, btn, alCambiar) {
    const ok = await preguntar('Paciente no podrá acudir', ['¿Confirma que ' + f.nombre + ' no podrá acudir a su cita del ' + fechaLarga(f.cita_fecha) + '?',
      'La solicitud se cerrará como "No podrá acudir" y el cupo de ese día quedará libre para otro paciente.'], 'Sí, no podrá acudir', 'Volver', 'peligro');
    if (!ok) return;
    try {
      const r = await conBoton(btn, function () { return api('cita.no_acudira', { id: f.id }); });
      f = aplicarFila(r);
      if (S.panel && S.panel.id === f.id) S.panel = null;
      tostada(f.nombre + ': no podrá acudir. Cupo liberado.', { accion: { texto: 'Deshacer', fn: function () { marcar(f, 'P|', 'N|' + NO_ACUDIRA, null, true); } } });
      refrescarDetalle(f.id);
      alCambiar(true);
    } catch (e) { tostada(e.message, { error: true }); }
  }

  /* ============================== calendario ============================== */
  /** Calendario del mes con citas / cupos por día. op.alElegir(fecha) cambia lo que pasa al tocar un día. */
  function calendario(u, op) {
    const o = op || {};
    const p = u.mes.split('-').map(Number);
    const primero = u.mes + '-01';
    const diasMes = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    const desfase = diaSemana(primero) - 1;
    const rejilla = h('div', { class: 'cal-rejilla', role: 'grid', 'aria-label': 'Calendario de citas' },
      LETRAS_DIA.map(function (l, i) { return h('div', { class: 'cal-dsem', title: NOMBRES_DIA[i] }, l); }));
    for (let i = 0; i < desfase; i++) rejilla.appendChild(h('div', { class: 'cal-dia vacio-mes' }));
    for (let d = 1; d <= diasMes; d++) {
      const fecha = u.mes + '-' + String(d).padStart(2, '0');
      const r = resumenDia(fecha, u.medico);
      const pasado = fecha < S.hoy;
      const clases = ['cal-dia', r.clase, r.clase === 'sin' && r.extra ? 'con-extra' : '', pasado ? 'pasado' : '', fecha === S.hoy ? 'hoy' : '', u.dia === fecha ? 'elegido' : '', !u.medico ? 'con-det' : ''].join(' ');
      const det = !u.medico ? h('div', { class: 'det' }, r.det.map(function (x) {
        return h('span', { class: x.cupos && x.usados >= x.cupos ? 'full' : '' }, medCorto(x.medico) + ' ' + (x.cupos ? x.usados + '/' + x.cupos : '· ' + x.usados + ' extra'));
      })) : null;
      const etiqueta = fechaSinAnio(fecha) + ': ' + (r.cupos ? r.usados - r.extra + ' de ' + r.cupos + ' cupos ocupados' : 'sin cupos') +
        (u.medico ? ' de ' + u.medico : '') + (r.extra ? ' · ' + plural(r.extra, 'extracurricular', 'extracurriculares') : '');
      rejilla.appendChild(h('button', { type: 'button', class: clases, 'aria-label': etiqueta, title: etiqueta, 'aria-pressed': String(u.dia === fecha),
        disabled: o.soloFuturo && pasado,
        onclick: function () { if (o.alElegir) o.alElegir(fecha); else { u.dia = u.dia === fecha ? '' : fecha; pintar(); } } },
      h('span', { class: 'n' }, d), det, h('span', { class: 'c' }, r.cupos ? (r.usados - r.extra) + '/' + r.cupos : ''),
      r.extra ? h('span', { class: 'ex' }, '+' + r.extra + ' extra') : null));
    }
    const cambiarMes = async function (delta) {
      const n = new Date(Date.UTC(p[0], p[1] - 1 + delta, 1)).toISOString().slice(0, 7);
      u.mes = n;
      if (!o.alElegir) u.dia = '';
      const inicio = sumarDias(n + '-01', -7);
      if (S.desde && inicio < S.desde) {
        try { await cargarAntiguos(inicio); } catch (e) { tostada(e.message, { error: true }); }
      }
      pintar();
    };
    const filtros = h('div', { class: 'cal-filtros', role: 'group', 'aria-label': 'Médico' },
      [['', 'Todos']].concat(medicosActivos().map(function (m) { return [m, medCorto(m)]; })).map(function (x) {
        return h('button', { type: 'button', class: 'cal-filtro', 'aria-pressed': String(u.medico === x[0]), title: x[0] || 'Todos los médicos',
          onclick: function () { u.medico = x[0]; pintar(); } }, x[1]);
      }));
    return h('section', { class: 'panel' },
      o.titulo ? h('h3', null, o.titulo) : null,
      h('div', { class: 'cal-cab' },
        h('div', { class: 'cal-nav' },
          h('button', { type: 'button', class: 'btn', 'aria-label': 'Mes anterior', onclick: function () { cambiarMes(-1); } }, '‹'),
          h('h3', null, MESES[p[1] - 1] + ' ' + p[0]),
          h('button', { type: 'button', class: 'btn', 'aria-label': 'Mes siguiente', onclick: function () { cambiarMes(1); } }, '›')),
        u.mes !== S.hoy.slice(0, 7) ? h('button', { type: 'button', class: 'btn chico', onclick: function () { u.mes = S.hoy.slice(0, 7); if (!o.alElegir) u.dia = ''; pintar(); } }, 'Ir a hoy') : null,
        filtros),
      rejilla,
      h('div', { class: 'cal-leyenda' }, h('span', null, h('i', { class: 'libre' }), 'Hay cupos'), h('span', null, h('i', { class: 'lleno' }), 'Cupos completos'),
        h('span', null, h('i', { class: 'sin' }), 'Sin cupos'), h('span', null, h('i', { class: 'extra' }), 'Con extracurriculares'),
        h('span', null, 'Cifra: citas / cupos' + (u.medico ? ' de ' + u.medico : ' (todos los médicos)') + '. ' + (o.ayuda || 'Toque un día para ver quién viene.'))));
  }

  function listaCitas(citas) {
    return h('ul', { class: 'lista-citas' }, citas.map(function (f) {
      return h('li', { class: f.motivo_no === NO_ACUDIRA ? 'cancelada' : '', tabindex: '0', onclick: function () { abrirDetalle(f); },
        onkeydown: function (ev) { if (ev.key === 'Enter') abrirDetalle(f); } },
      h('span', { class: 'hr' }, hora12(f.cita_hora)),
      h('span', null, h('b', null, f.nombre), h('span', { class: 'tenue' }, f.cita_medico + ' · ' + hospCorto(f.hospital)), chipTipo(f)),
      f.estado === 'PENDIENTE' ? (f.notificado ? h('span', { class: 'chip ok' }, 'Notificado') : h('span', { class: 'chip gris' }, 'Sin notificar')) : chipEstado(f));
    }));
  }

  function detalleDia(u) {
    const fecha = u.dia;
    const r = resumenDia(fecha, '');
    const citas = citasDe(fecha).filter(function (f) { return !u.medico || f.cita_medico === u.medico; })
      .sort(function (a, b) { return (a.motivo_no === NO_ACUDIRA) - (b.motivo_no === NO_ACUDIRA) || ORDENES.hora[1](a, b); });
    return h('section', { class: 'panel dia-detalle' },
      h('div', { class: 'cab', style: 'margin-bottom:8px' }, h('h3', { style: 'margin:0;flex:1' }, 'Citas del ' + fechaLarga(fecha)),
        h('a', { class: 'btn chico', href: '#/agenda/' + fecha }, 'Abrir agenda de ese día'),
        h('button', { class: 'btn chico', 'aria-label': 'Cerrar', onclick: function () { u.dia = ''; pintar(); } }, '✕')),
      h('div', { class: 'resumen' }, r.det.length ? r.det.map(function (x) {
        return h('span', { class: 'chip ' + (x.cupos === 0 ? 'extra' : x.usados >= x.cupos ? 'urg' : 'dem') },
          x.medico + (x.cupos ? ' ' + x.usados + '/' + x.cupos : ' · ' + plural(x.usados, 'extracurricular', 'extracurriculares')) + (x.cerrado ? ' · ' + (x.motivo || 'sin cupos') : ''));
      }) : h('span', { class: 'chip gris' }, 'Ningún médico tiene cupos este día')),
      citas.length ? listaCitas(citas) : h('p', { style: 'margin:0;color:#51606f' }, 'No hay citas ' + (u.medico ? 'de ' + u.medico + ' ' : '') + 'para este día.'));
  }

  /* ============================== asignación de citas ============================== */
  function vistaCitas(main) {
    const u = ui('citas', { mes: S.hoy.slice(0, 7), medico: '', dia: '', tab: 'sin', orden: 'fecha', dir: 1, fHosp: '', fOrigen: '' });
    const pend = filasArr().filter(function (f) { return f.estado === 'PENDIENTE'; });
    // La fila que se está editando sigue visible aunque ya no corresponda a la pestaña (p. ej. recién agendada),
    // para que se pueda notificar en seguida. Sale de la lista al cerrar su panel.
    const abierta = function (f) { return S.panel && S.panel.id === f.id; };
    const grupos = {
      sin: pend.filter(function (f) { return !f.cita_fecha || abierta(f); }),
      notificar: pend.filter(function (f) { return (f.cita_fecha && !f.notificado && f.cita_fecha >= S.hoy) || abierta(f); }),
      con: pend.filter(function (f) { return f.cita_fecha || abierta(f); }),
      todas: filasArr()
    };
    const titulos = { sin: 'Por agendar', notificar: 'Por notificar', con: 'Agendadas', todas: 'Todas' };
    const cambiar = function (t) {
      u.tab = t;
      S.panel = null;
      u.limite = 150;
      if (t === 'sin') { u.orden = 'fecha'; u.dir = 1; } else if (t === 'todas') { u.orden = 'fecha'; u.dir = -1; } else { u.orden = 'cita'; u.dir = 1; }
      pintar();
    };
    const base = grupos[u.tab].filter(function (f) { return (!u.fHosp || f.hospital === u.fHosp) && (!u.fOrigen || f.origen === u.fOrigen); });
    const ordenes = ['fecha', 'cita', 'medico', 'nombre', 'hospital'];
    agregar(main, [
      calendario(u),
      u.dia ? detalleDia(u) : null,
      h('div', { class: 'cab', style: 'margin-top:18px' }, h('h2', null, 'Solicitudes'),
        h('a', { class: 'btn no-imprimir', href: '#/registro' }, '+ Registro manual'),
        h('span', { class: 'estado-form' }, 'Toque la primera columna para asignar la cita, notificarla, reprogramarla o avisar que el paciente no podrá acudir.')),
      h('div', { class: 'pestanas', role: 'tablist' }, Object.keys(titulos).map(function (t) {
        return h('button', { class: 'pestana', role: 'tab', 'aria-selected': String(u.tab === t), onclick: function () { cambiar(t); } }, titulos[t], h('span', { class: 'n' }, grupos[t].length));
      })),
      controles(u, ordenes, [
        filtroSelect('ci-hosp', 'Hospital', opcionesHospital(grupos[u.tab]), u.fHosp, function (v) { u.fHosp = v; }),
        filtroSelect('ci-origen', 'Origen', [['', 'Todos'], ['FORMULARIO', 'Formulario'], ['MANUAL', 'Registro manual']], u.fOrigen, function (v) { u.fOrigen = v; })]),
      tabla(aplicar(base, u), u, { plegable: true, ordenes: ordenes, columnas: ['cita', 'solicitud', 'paciente', 'edad', 'hospital', 'telefono'],
        vacio: { sin: 'No hay solicitudes por agendar.', notificar: 'Todas las citas próximas ya se notificaron.', con: 'No hay solicitudes agendadas en espera.', todas: 'No hay solicitudes en el periodo cargado.' }[u.tab] })
    ]);
  }

  /* ============================== agenda ============================== */
  function vistaAgenda(main, fecha) {
    const u = ui('agenda', { medico: '' });
    if (esMedico()) u.medico = miMedico();
    if (S.desde && fecha < S.desde) {
      main.appendChild(h('div', { class: 'vacio' }, 'Cargando citas de ese día…'));
      cargarAntiguos(sumarDias(fecha, -7)).then(pintar).catch(function (e) { tostada(e.message, { error: true }); });
      return;
    }
    if (esMedico() && !miMedico()) {
      main.appendChild(h('div', { class: 'aviso alerta' }, 'Su usuario no está vinculado a ningún médico de la lista, así que no tiene agenda. Pida al administrador que lo vincule en "Usuarios y médicos".'));
      return;
    }
    const delDiaMed = medicosDelDia(fecha);
    const delDia = citasDe(fecha).filter(function (f) { return !esMedico() || f.cita_medico === miMedico(); });
    const filas = delDia.filter(function (f) { return !u.medico || f.cita_medico === u.medico; })
      .sort(function (a, b) { return (a.motivo_no === NO_ACUDIRA) - (b.motivo_no === NO_ACUDIRA) || (u.medico ? 0 : cmp(a.cita_medico, b.cita_medico)) || ORDENES.hora[1](a, b); });
    const activas = filas.filter(function (f) { return f.motivo_no !== NO_ACUDIRA; });
    const pend = activas.filter(function (f) { return f.estado === 'PENDIENTE'; }).length;
    const ir = function (d) { location.hash = '#/agenda/' + d; };
    const esHoy = fecha === S.hoy;
    const mio = esMedico() ? delDiaMed.filter(function (x) { return x.medico === miMedico(); })[0] : null;
    // Médico: sus próximos días con turno o con citas, para saltar a ellos.
    let proximos = null;
    if (esMedico()) {
      const dias = [];
      for (let i = 0; i < 45 && dias.length < 6; i++) {
        const d = sumarDias(S.hoy, i);
        const n = citasDe(d).filter(function (f) { return f.cita_medico === miMedico() && ocupa(f); }).length;
        if (n || cuposDia(d, miMedico()).cupos) dias.push([d, n]);
      }
      proximos = dias.length ? h('div', { class: 'mis-dias no-imprimir' }, dias.map(function (x) {
        return h('a', { class: 'fecha-chip', href: '#/agenda/' + x[0], 'aria-pressed': String(x[0] === fecha) }, fechaChip(x[0]), h('small', null, plural(x[1], 'cita', 'citas')));
      })) : null;
    }
    agregar(main, [
      h('div', { class: 'cab' },
        h('h2', null, (esMedico() ? 'Mi agenda' : 'Agenda') + (esHoy ? ' de hoy' : ' del ' + fechaSinAnio(fecha)),
          h('small', { style: 'display:block;font-size:14px;font-weight:500;color:#51606f;margin-top:4px' },
            fechaLarga(fecha) + ' · ' + plural(activas.length, 'cita', 'citas') + ' · ' + pend + ' por marcar' + (mio && mio.cupos ? ' · ' + mio.usados + ' de ' + mio.cupos + ' cupos' : ''))),
        h('div', { class: 'nav-dia no-imprimir' },
          h('button', { class: 'btn', 'aria-label': 'Día anterior', onclick: function () { ir(sumarDias(fecha, -1)); } }, '‹'),
          !esHoy ? h('button', { class: 'btn', onclick: function () { ir(S.hoy); } }, 'Hoy') : null,
          h('input', { type: 'date', 'aria-label': 'Ir a la fecha', value: fecha, onchange: function (ev) { if (ev.target.value) ir(ev.target.value); } }),
          h('button', { class: 'btn', 'aria-label': 'Día siguiente', onclick: function () { ir(sumarDias(fecha, 1)); } }, '›'),
          h('button', { class: 'btn', onclick: function () { window.print(); } }, 'Imprimir'))),
      proximos,
      // Gestión: una pestaña por médico del día, con citas / cupos (en rojo si hay sobrecupo).
      !esMedico() ? h('div', { class: 'pestanas pestanas-estudio no-imprimir', role: 'tablist' },
        h('button', { class: 'pestana', role: 'tab', 'aria-selected': String(!u.medico), onclick: function () { u.medico = ''; pintar(); } }, 'Todos',
          h('span', { class: 'n' }, delDia.filter(function (f) { return f.motivo_no !== NO_ACUDIRA; }).length)),
        delDiaMed.map(function (x) {
          return h('button', { class: 'pestana', role: 'tab', 'aria-selected': String(u.medico === x.medico),
            title: x.medico + ': ' + x.usados + ' citas de ' + x.cupos + ' cupos' + (x.cerrado ? ' · ' + (x.motivo || 'sin cupos') : ''),
            onclick: function () { u.medico = x.medico; pintar(); } },
          x.medico, h('span', { class: 'n' + (x.usados > x.cupos ? ' sobre' : '') }, x.usados + '/' + x.cupos));
        })) : null,
      u.medico ? h('p', { class: 'solo-imprimir' }, 'Médico: ' + u.medico) : null,
      tabla(filas, { limite: 500, orden: 'hora', dir: 1 }, { ordenes: [], columnas: ['marcar', 'hora', 'paciente', 'edad', 'hospital', 'telefono'].concat(u.medico ? [] : ['medicoCita']),
        vacio: 'No hay citas ' + (u.medico ? (esMedico() ? 'en su agenda ' : 'de ' + u.medico + ' ') : '') + 'para este día.' }),
      h('p', { class: 'no-imprimir', style: 'color:#51606f;font-size:13.5px' }, 'Toque un paciente para ver la solicitud completa, con el EKG y la radiografía si se adjuntaron. Las citas canceladas ("No podrá acudir") aparecen al final, en gris.')
    ]);
  }

  /* ============================== archivos y detalle ============================== */
  async function obtenerArchivo(id, cual) {
    return descargarArchivo(id + '|' + cual, function () { return api('archivo', { id: id, cual: cual }); });
  }
  async function descargarArchivo(llave, pedir) {
    if (S.archivos.has(llave)) return S.archivos.get(llave);
    const d = await pedir();
    const bin = atob(d.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: d.tipo });
    const a = { url: URL.createObjectURL(blob), blob: blob, tipo: d.tipo, nombre: d.nombre };
    S.archivos.set(llave, a);
    if (S.archivos.size > 24) { const vieja = S.archivos.keys().next().value; URL.revokeObjectURL(S.archivos.get(vieja).url); S.archivos.delete(vieja); }
    return a;
  }
  function olvidarArchivo(llave) {
    Array.from(S.archivos.keys()).forEach(function (k) {
      if (k.indexOf(llave) === 0) { URL.revokeObjectURL(S.archivos.get(k).url); S.archivos.delete(k); }
    });
  }
  function visor(url) {
    const img = h('img', { src: url, class: 'ajustar', alt: 'Imagen ampliada' });
    const v = h('div', { class: 'visor' }, h('button', { class: 'btn cerrar' }, '✕ Cerrar'), img);
    const cerrar = function () { v.remove(); document.removeEventListener('keydown', tecla, true); };
    const tecla = function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); cerrar(); } };
    img.addEventListener('click', function (ev) { ev.stopPropagation(); img.classList.toggle('ajustar'); v.style.cursor = img.classList.contains('ajustar') ? 'zoom-out' : 'zoom-in'; });
    v.addEventListener('click', cerrar);
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(v);
  }
  function panelArchivo(f, cual, titulo) {
    const lienzo = h('div', { class: 'lienzo' });
    const acciones = h('span');
    if (!f[cual]) {
      lienzo.textContent = 'No se adjuntó.';
    } else {
      lienzo.appendChild(h('div', null, h('div', { class: 'giro' }), h('div', { style: 'margin-top:8px' }, 'Cargando…')));
      obtenerArchivo(f.id, cual).then(function (a) {
        lienzo.textContent = '';
        acciones.appendChild(h('a', { class: 'btn chico', href: a.url, target: '_blank', rel: 'noopener' }, 'Abrir en otra pestaña'));
        if (a.tipo === 'application/pdf') {
          if (navigator.pdfViewerEnabled) lienzo.appendChild(h('iframe', { src: a.url, title: titulo }));
          else lienzo.textContent = 'Documento PDF. Use "Abrir en otra pestaña" para verlo.';
        } else {
          lienzo.appendChild(h('img', { src: a.url, alt: titulo, title: 'Clic para ampliar', onclick: function () { visor(a.url); } }));
        }
      }).catch(function (e) { lienzo.textContent = 'No se pudo cargar: ' + e.message; });
    }
    return h('div', { class: 'archivo' }, h('div', { class: 'tit' }, titulo, acciones), lienzo);
  }

  /* ============================== reporte ============================== */
  const TEXTO_REPORTE = { 'AUTOMÁTICO': 'Vinculado automáticamente', 'CONFIRMADO': 'Reporte confirmado', 'CARGADO': 'Cargado a mano', 'POR REVISAR': 'Por revisar' };
  function reporteListo(f) { return !!f.reporte && f.reporte_estado !== 'POR REVISAR'; }
  function chipReporte(f) {
    if (!f.reporte) return null;
    return h('span', { class: 'chip ' + (f.reporte_estado === 'POR REVISAR' ? 'alerta' : 'ok') }, TEXTO_REPORTE[f.reporte_estado] || 'Con reporte');
  }
  /** Botón junto a "Realizado por": subir el reporte, verlo o revisarlo. */
  function botonReporte(f) {
    if (f.reporte) {
      const revisar = f.reporte_estado === 'POR REVISAR';
      return h('button', { type: 'button', class: 'btn chico btn-rep no-imprimir ' + (revisar ? 'revisar' : 'con'),
        title: revisar ? 'Se encontró un reporte que podría ser de este paciente. Revíselo y confírmelo.' : TEXTO_REPORTE[f.reporte_estado] || 'Ver el reporte',
        onclick: function (ev) { ev.stopPropagation(); abrirDetalle(S.filas.get(f.id) || f, { ir: 'reporte' }); } }, revisar ? 'Revisar reporte' : 'Ver reporte ✓');
    }
    if (f.estado === 'NO REALIZADO' || !puedeMarcar(f)) return null;
    return h('button', { type: 'button', class: 'btn chico btn-rep sin no-imprimir',
      title: 'Subir una foto o un PDF del reporte. El reporte también se busca solo cada hora en la carpeta de Drive del ecógrafo.',
      onclick: function (ev) { ev.stopPropagation(); elegirArchivoReporte(f, ev.currentTarget); } }, '+ Subir reporte');
  }
  function celdaMarcar(f) {
    if (!puedeMarcar(f)) return h('div', { class: 'marcar-caja' }, chipEstado(f), botonReporte(f));
    return h('div', { class: 'marcar-caja' }, selectorMarcado(f), botonReporte(f));
  }
  function elegirArchivo(accept, fn) {
    const input = h('input', { type: 'file', accept: accept, style: 'display:none' });
    input.addEventListener('change', function () {
      const archivo = input.files && input.files[0];
      input.remove();
      if (archivo) fn(archivo);
    });
    document.body.appendChild(input);
    input.click();
  }
  function elegirArchivoReporte(f, btn) { elegirArchivo('image/*,application/pdf,.pdf', function (a) { subirReporte(f, a, btn); }); }

  /** PDF tal cual; las fotos se reducen (máx. 2400 px, JPG) para que suban rápido con mala conexión. */
  async function prepararArchivo(archivo) {
    const ext = (String(archivo.name || '').split('.').pop() || '').toLowerCase();
    if (archivo.type === 'application/pdf' || ext === 'pdf') {
      if (archivo.size > MAX_ARCHIVO) throw new Error('El PDF pesa más de 8 MB.');
      return archivo;
    }
    if (!/^image\//.test(archivo.type) && ['jpg', 'jpeg', 'png'].indexOf(ext) < 0) throw new Error('Use una foto (JPG o PNG) o un PDF.');
    const url = URL.createObjectURL(archivo);
    try {
      const img = await new Promise(function (ok, mal) {
        const i = new Image();
        i.onload = function () { ok(i); };
        i.onerror = function () { mal(new Error('No se pudo abrir la imagen. Pruebe con otra foto o con un PDF.')); };
        i.src = url;
      });
      const escala = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      if (/^image\/(jpeg|png)$/.test(archivo.type) && escala === 1 && archivo.size <= 900 * 1024) return archivo;
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * escala);
      c.height = Math.round(img.naturalHeight * escala);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      const b = await new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.88); });
      if (!b) throw new Error('No se pudo preparar la imagen.');
      if (b.size > MAX_ARCHIVO) throw new Error('La imagen pesa más de 8 MB.');
      return b;
    } finally { URL.revokeObjectURL(url); }
  }
  function aBase64(blob) {
    return new Promise(function (ok, mal) {
      const r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { mal(new Error('No se pudo leer el archivo.')); };
      r.readAsDataURL(blob);
    });
  }
  async function subirReporte(f, archivo, btn) {
    if (f.reporte && !(await preguntar('¿Reemplazar el reporte?', 'Esta solicitud ya tiene un reporte. El archivo nuevo lo reemplazará.', 'Sí, reemplazar', 'Cancelar'))) return;
    const trabajo = async function () {
      const blob = await prepararArchivo(archivo);
      const r = await api('reporte.subir', { id: f.id, archivo: { b64: await aBase64(blob) } });
      olvidarArchivo(f.id + '|reporte');
      return aplicarFila(r);
    };
    try {
      const x = btn && btn.isConnected ? await conBoton(btn, trabajo) : await trabajo();
      tostada('Reporte cargado · ' + x.nombre);
    } catch (e) { tostada(e.message, { error: true }); }
    refrescarDetalle(f.id);
    pintar();
  }
  async function accionReporte(f, accion, btn, mensaje, datos) {
    try {
      const r = await conBoton(btn, function () { return api(accion, Object.assign({ id: f.id }, datos || {})); });
      if (accion !== 'reporte.confirmar') olvidarArchivo(f.id + '|reporte');
      aplicarFila(r);
      tostada(mensaje);
    } catch (e) { tostada(e.message, { error: true }); }
    refrescarDetalle(f.id);
    pintar();
  }
  function botonChico(texto, clase, fn) { return h('button', { type: 'button', class: 'btn chico ' + (clase || ''), onclick: function (ev) { fn(ev.currentTarget); } }, texto); }

  /** Contenido de la sección "Reporte del estudio" en el detalle. */
  function pintarReporte(caja, f) {
    caja.textContent = '';
    const puede = puedeMarcar(f);
    const subir = puede ? botonChico(f.reporte ? 'Reemplazar (subir foto o PDF)' : 'Subir foto o PDF', f.reporte ? '' : 'oscuro', function (b) { elegirArchivoReporte(f, b); }) : null;
    const buscar = puede ? botonChico(f.reporte ? 'Elegir otro del censo' : 'Buscar en el censo de reportes', '', function () { elegirDelCenso(f); }) : null;
    if (!f.reporte) {
      agregar(caja, [
        h('p', { class: 'tenue', style: 'margin:0 0 6px' }, 'Sin reporte. El reporte se busca automáticamente cada hora (7:00 a. m. a 3:59 p. m.) en la carpeta de Drive del ecógrafo.' + (puede ? ' También puede buscarlo en el censo o subir una foto o un PDF.' : '')),
        f.reporte_info ? h('p', { class: 'tenue', style: 'margin:0 0 10px' }, f.reporte_info) : null,
        h('div', { class: 'acciones-rep' }, subir, buscar)]);
      return;
    }
    const revisar = f.reporte_estado === 'POR REVISAR';
    const vistaRep = panelArchivo(f, 'reporte', 'Reporte');
    vistaRep.classList.add('reporte');
    agregar(caja, [
      h('div', { class: 'linea-rep' }, chipReporte(f), f.reporte_info ? h('span', { class: 'tenue' }, f.reporte_info) : null),
      revisar ? h('div', { class: 'aviso alerta', style: 'margin-top:0' }, h('b', null, '¿Este reporte es de ' + f.nombre + '?'),
        ' Exp. ' + (f.expediente || 's/d') + ' · nacimiento ' + (f.fecha_nacimiento || 's/d') + '. Compare los datos del reporte antes de confirmar.') : null,
      puede ? h('div', { class: 'acciones-rep' },
        revisar ? botonChico('Sí, corresponde', 'primario', function (b) { accionReporte(f, 'reporte.confirmar', b, 'Reporte confirmado.'); }) : null,
        revisar ? botonChico('No corresponde', 'peligro', function (b) { accionReporte(f, 'reporte.descartar', b, 'Se quitó el reporte propuesto; no se volverá a proponer.'); }) : null,
        buscar, subir,
        revisar ? null : botonChico('Quitar reporte', 'peligro', async function (b) {
          if (await preguntar('¿Quitar el reporte?', 'La solicitud quedará sin reporte. Ese archivo no se le volverá a proponer automáticamente.', 'Sí, quitar', 'Cancelar', 'peligro')) {
            accionReporte(f, 'reporte.descartar', b, 'Reporte quitado.');
          }
        })) : null,
      h('div', { style: 'margin-top:12px' }, vistaRep)]);
  }

  /** Busca en el censo de reportes (los más parecidos al paciente primero) y permite elegir el correcto. */
  function elegirDelCenso(f) {
    abrirModal(function (cerrar) {
      const lista = h('div', { class: 'lista-censo' }, h('div', { class: 'vacio' }, 'Buscando en el censo…'));
      const vista = h('div', { class: 'vista-censo' });
      const err = cajaError();
      const q = h('input', { type: 'search', id: 'censo-q', placeholder: 'Nombre o ID del paciente', autocomplete: 'off', 'data-foco': true });
      let pedido = 0;
      const marca = function (ok, texto) { return h('span', { class: 'chip ' + (ok ? 'ok' : 'gris') }, (ok ? '✓ ' : '✕ ') + texto); };
      const buscar = async function () {
        const n = ++pedido;
        err.textContent = '';
        try {
          const r = await api('reportes.buscar', { id: f.id, q: q.value.trim() });
          if (n === pedido) pintarLista(r);
        } catch (e) { if (n === pedido) { lista.textContent = ''; mostrarError(err, e); } }
      };
      q.addEventListener('input', function () { clearTimeout(q._t); q._t = setTimeout(buscar, 350); });
      const ver = async function (x, btn) {
        try {
          const a = await conBoton(btn, function () { return descargarArchivo('censo|' + x.archivo, function () { return api('reporte.archivo', { archivo: x.archivo }); }); });
          vista.textContent = '';
          vista.appendChild(h('div', { class: 'archivo reporte', style: 'margin-bottom:12px' },
            h('div', { class: 'tit' }, h('span', null, (x.paciente || x.nombre_archivo) + ' · ' + fechaHora(x.fecha_hora)),
              h('span', { class: 'acciones-rep' }, h('a', { class: 'btn chico', href: a.url, target: '_blank', rel: 'noopener' }, 'Abrir en otra pestaña'),
                h('button', { type: 'button', class: 'btn chico', onclick: function () { vista.textContent = ''; } }, 'Ocultar'))),
            h('div', { class: 'lienzo' }, navigator.pdfViewerEnabled ? h('iframe', { src: a.url, title: 'Reporte del censo' }) : 'Documento PDF. Use "Abrir en otra pestaña" para verlo.')));
          vista.scrollIntoView({ block: 'start' });
        } catch (e) { mostrarError(err, e); }
      };
      const elegir = async function (x, btn) {
        let mover = false, otra = null;
        for (;;) {
          try {
            const r = await conBoton(btn, function () { return api('reporte.vincular', { id: f.id, archivo: x.archivo, mover: mover }); });
            olvidarArchivo(f.id + '|reporte');
            aplicarFila(r);
            break;
          } catch (e) {
            if (e.code === 'VINCULADO_A_OTRA' && !mover) {
              const idOtra = e.datos && e.datos.solicitud;
              otra = S.filas.get(idOtra) || null;
              const quien = otra ? ' (' + otra.nombre + ', solicitud del ' + fechaCorta(otra.fecha) + ')' : '';
              if (!(await preguntar('Ese reporte está en otra solicitud', 'Está vinculado a la solicitud ' + idOtra + quien + '. ¿Moverlo a esta solicitud? La otra quedará sin reporte.', 'Sí, moverlo aquí', 'Cancelar'))) return;
              mover = true;
              continue;
            }
            mostrarError(err, e);
            return;
          }
        }
        if (otra) { otra.reporte = ''; otra.reporte_estado = ''; otra.reporte_info = 'El reporte se movió a la solicitud ' + f.id + '.'; olvidarArchivo(otra.id + '|reporte'); }
        cerrar();
        tostada('Reporte vinculado a ' + f.nombre + '.');
        refrescarDetalle(f.id);
        pintar();
      };
      const pintarLista = function (r) {
        lista.textContent = '';
        if (!r.reportes.length) {
          lista.appendChild(h('div', { class: 'vacio' }, q.value.trim() ? 'Nada del censo coincide con la búsqueda.' :
            'Nada del censo coincide con el expediente, el nombre o la fecha de nacimiento. Busque por nombre o ID.'));
        }
        r.reportes.forEach(function (x) {
          const actual = x.solicitud === f.id;
          lista.appendChild(h('div', { class: 'item-censo' + (actual ? ' actual' : '') },
            h('div', { class: 'crece' }, h('b', null, x.paciente || x.nombre_archivo),
              h('div', { class: 'tenue' }, 'ID: ' + (x.id_paciente || '—') + ' · nacimiento: ' + (x.fnac || '—') + ' · estudio: ' + (fechaHora(x.fecha_hora) || '—')),
              h('div', { class: 'chips' }, marca(x.coincide.expediente, 'Expediente'), marca(x.coincide.nombre, 'Nombre'), marca(x.coincide.fnac, 'Nacimiento'),
                x.solicitud ? h('span', { class: 'chip ' + (actual ? 'azul' : 'alerta') }, actual ? 'Es el reporte actual' : 'En la solicitud ' + x.solicitud) : null)),
            h('div', { class: 'acciones-rep' },
              h('button', { type: 'button', class: 'btn chico', onclick: function (ev) { ver(x, ev.currentTarget); } }, 'Ver'),
              actual ? null : h('button', { type: 'button', class: 'btn chico primario', onclick: function (ev) { elegir(x, ev.currentTarget); } }, 'Elegir este'))));
        });
        lista.appendChild(h('p', { class: 'tenue', style: 'margin:10px 0 0;font-size:13px' }, 'Reportes en el censo: ' + r.total_censo + '. Se muestran hasta 40, primero los que más coinciden y los más cercanos a la fecha de la cita.'));
      };
      buscar();
      return h('div', { class: 'modal' },
        h('div', { class: 'modal-cab' },
          h('div', { style: 'min-width:0' }, h('h2', null, 'Elegir reporte del censo'),
            h('div', { class: 'meta' }, h('span', null, f.nombre), h('span', null, '· Exp. ' + (f.expediente || 's/d')), h('span', null, '· Nac. ' + (f.fecha_nacimiento || 's/d')),
              h('span', null, '· Solicitud ' + fechaCorta(f.fecha) + (f.cita_fecha ? ' · cita ' + fechaCorta(f.cita_fecha) : '')))),
          h('button', { class: 'btn chico x', onclick: cerrar, 'aria-label': 'Cerrar' }, '✕ Cerrar')),
        h('div', { class: 'modal-cuerpo' }, h('div', { class: 'todo' }, vista,
          h('div', { class: 'campo' }, h('label', { for: 'censo-q' }, 'Buscar (vacío = los que coinciden con el paciente)'), q), err, lista)));
    });
  }

  /* ============================== comentario ============================== */
  function seccionComentario(f0) {
    let f = f0;
    let guardado = f.comentario || '';
    const txt = h('textarea', { id: 'comentario-txt', rows: '5', maxlength: '5000', placeholder: 'Comentario sobre la solicitud o el estudio…', 'aria-label': 'Comentario' });
    txt.value = guardado;
    const info = h('span', { class: 'tenue' });
    const pintarInfo = function () {
      const cambios = txt.value !== guardado;
      info.textContent = (cambios ? 'Sin guardar · ' : f.comentario_por ? 'Guardado por ' + f.comentario_por + ' · ' : '') + txt.value.length + '/5000';
      info.classList.toggle('sin-guardar', cambios);
    };
    txt.addEventListener('input', pintarInfo);
    // Al elegir una plantilla se inserta donde está el cursor (o reemplaza el cuadro si está vacío).
    const sel = S.plantillas.length ? selector([['', 'Insertar plantilla…']].concat(S.plantillas.map(function (p, i) { return [String(i), p.nombre]; })), '',
      { id: 'plantilla-sel', 'aria-label': 'Insertar plantilla', onchange: function () {
        if (sel.value === '') return;
        const p = S.plantillas[Number(sel.value)];
        sel.value = '';
        const v = txt.value;
        if (!v.trim()) txt.value = p.texto;
        else {
          const ini = typeof txt.selectionStart === 'number' ? txt.selectionStart : v.length, fin = typeof txt.selectionEnd === 'number' ? txt.selectionEnd : v.length;
          const antes = v.slice(0, ini), despues = v.slice(fin);
          txt.value = antes + (antes && !/\n$/.test(antes) ? '\n' : '') + p.texto + (despues && !/^\n/.test(despues) ? '\n' : '') + despues;
        }
        txt.focus();
        pintarInfo();
      } }) : null;
    const guardar = h('button', { type: 'button', class: 'btn primario', onclick: async function (ev) {
      try {
        const r = await conBoton(ev.currentTarget, function () { return api('comentario.guardar', { id: f.id, texto: txt.value }); });
        f = aplicarFila(r);
        txt.value = guardado = f.comentario || '';
        pintarInfo();
        tostada(guardado ? 'Comentario guardado.' : 'Comentario borrado.');
      } catch (e) { tostada(e.message, { error: true }); }
    } }, 'Guardar comentario');
    pintarInfo();
    return {
      sinGuardar: function () { return txt.value !== guardado; },
      seccion: h('section', { class: 'ficha todo comentario' }, h('h3', null, 'Comentario'), txt,
        h('div', { class: 'barra-com' }, info, h('div', { class: 'acciones-rep' }, sel ||
          (esAdmin() ? h('span', { class: 'tenue', style: 'font-size:13px' }, 'Puede crear plantillas en "Usuarios y médicos".') : null), guardar)))
    };
  }

  function dato(et, valor) { return h('div', null, h('dt', null, et), h('dd', null, valor || '—')); }
  function refrescarDetalle(id) { if (S.detalleAbierto && S.detalleAbierto.id === id) S.detalleAbierto.fn(S.filas.get(id)); }

  function abrirDetalle(f0, op) {
    let f = f0;
    const peso = Number(f.peso), talla = Number(f.talla);
    const imc = peso > 0 && talla > 0 ? (peso / Math.pow(talla / 100, 2)).toFixed(1) : '';
    const sc = peso > 0 && talla > 0 ? Math.sqrt(peso * talla / 3600).toFixed(2) + ' m²' : '';
    const seccionCita = h('div');
    const resultado = h('div');
    const st = Object.assign(nuevoEstadoPanel(f), { modo: 'opciones' });
    const pintarCita = function () {
      seccionCita.textContent = '';
      if (f.citas_previas) seccionCita.appendChild(h('p', { class: 'texto-largo', style: 'margin:0 0 10px' }, h('b', null, 'Citas anteriores'), f.citas_previas.split(' | ').join('\n')));
      if (f.estado !== 'PENDIENTE' && !f.cita_fecha) { seccionCita.appendChild(h('p', { style: 'margin:0;color:#51606f' }, 'No tuvo cita asignada.')); return; }
      seccionCita.appendChild(panelCita(f, st, function () { f = S.filas.get(f.id) || f; pintarCita(); pintar(); }));
    };
    const pintarResultado = function () {
      resultado.textContent = '';
      agregar(resultado, [puedeMarcar(f) ? h('div', { style: 'margin-bottom:10px' }, selectorMarcado(f)) : null,
        h('dl', { class: 'datos' }, dato('Estado', chipEstado(f)), f.estado !== 'PENDIENTE' ? dato('Fecha de cierre', fechaHora(f.fecha_cierre)) : null,
          f.marcado_por ? dato('Marcado por', f.marcado_por) : null)]);
    };
    const seccionReporte = h('section', { class: 'ficha todo', id: 'seccion-reporte' }, h('h3', null, 'Reporte del estudio'));
    const cajaReporte = h('div');
    seccionReporte.appendChild(cajaReporte);
    const comentario = seccionComentario(f);
    pintarCita();
    pintarResultado();
    pintarReporte(cajaReporte, f);
    S.detalleAbierto = { id: f.id, fn: function (x) { if (x) f = x; pintarCita(); pintarResultado(); pintarReporte(cajaReporte, f); } };
    const tel = function (t) { return t ? h('a', { href: 'tel:' + t }, telefono(t)) : ''; };
    abrirModal(function (cerrar) {
      return h('div', { class: 'modal' },
        h('div', { class: 'modal-cab' },
          h('div', { style: 'min-width:0' }, h('h2', null, f.nombre),
            h('div', { class: 'meta' }, h('span', { class: 'chip marca' }, ESTUDIO), h('span', null, 'Solicitud ' + f.id), h('span', null, '·'), h('span', null, fechaHora(f.fecha_hora)),
              chipOrigen(f), S.repetidas.has(f.id) ? h('span', { class: 'chip rep' }, 'Posible repetida') : null)),
          h('button', { class: 'btn chico x', onclick: cerrar, 'aria-label': 'Cerrar' }, '✕ Cerrar')),
        h('div', { class: 'modal-cuerpo' },
          h('section', { class: 'ficha' }, h('h3', null, 'Paciente'), h('dl', { class: 'datos' },
            dato('Expediente', f.expediente), dato('Fecha de nacimiento', f.fecha_nacimiento), dato('Edad', f.edad === '' ? '' : f.edad === '0' ? edadCorta(f).replace(' m', ' meses') : f.edad + ' años'),
            dato('Sexo', f.sexo), dato('Peso', f.peso ? f.peso + ' kg' : ''), dato('Talla', f.talla ? f.talla + ' cm' : ''),
            dato('IMC', imc), dato('Superficie corporal', sc), dato('Teléfono', tel(f.contacto)))),
          h('section', { class: 'ficha' }, h('h3', null, 'Procedencia'), h('dl', { class: 'datos' },
            h('div', { style: 'grid-column:1/-1' }, h('dt', null, 'Hospital que refiere'), h('dd', null, f.hospital || '—')),
            dato('Origen', ORIGENES[f.origen] || f.origen),
            f.origen === 'MANUAL' ? dato('Registrado por', f.registrado_por) : null,
            f.ts_nombre ? dato('Trabajo Social', f.ts_nombre) : null,
            f.ts_contacto ? dato('Teléfono de Trabajo Social', tel(f.ts_contacto)) : null)),
          h('section', { class: 'ficha todo' }, h('h3', null, 'Motivo del estudio'), h('p', { class: 'texto-largo' }, f.motivo || '—')),
          h('section', { class: 'todo archivos' }, panelArchivo(f, 'ekg', 'Electrocardiograma'), panelArchivo(f, 'rx', 'Placa de rayos X')),
          h('section', { class: 'ficha todo' }, h('h3', null, 'Cita'), seccionCita),
          h('section', { class: 'ficha todo' }, h('h3', null, 'Resultado'), resultado),
          seccionReporte,
          comentario.seccion));
    }, { alCerrar: function () { S.detalleAbierto = null; },
      antesDeCerrar: function () {
        return !comentario.sinGuardar() || preguntar('Comentario sin guardar', 'Escribió un comentario que todavía no se ha guardado.', 'Cerrar sin guardar', 'Seguir editando', 'peligro');
      } });
    if (op && op.ir === 'reporte') seccionReporte.scrollIntoView({ block: 'start' });
  }

  /* ============================== registro manual ============================== */
  function edadDe(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || ''));
    if (!m) return null;
    const d = Number(m[1]), mes = Number(m[2]), a = Number(m[3]);
    if (a < 1900 || mes < 1 || mes > 12 || d < 1 || d > new Date(a, mes, 0).getDate()) return null;
    const nac = new Date(a, mes - 1, d);
    const p = partes(S.hoy || new Date().toISOString().slice(0, 10));
    const hoy = new Date(p[0], p[1] - 1, p[2]);
    if (nac > hoy) return null;
    let meses = (hoy.getFullYear() - a) * 12 + (hoy.getMonth() - (mes - 1));
    if (hoy.getDate() < d) meses--;
    return { anios: Math.floor(meses / 12), meses: meses, dias: Math.round((hoy - nac) / 86400000) };
  }
  function textoEdad(e) {
    if (!e) return '';
    if (e.anios >= 2) return e.anios + ' años';
    if (e.anios === 1) return '1 año (' + e.meses + ' meses)';
    if (e.meses >= 1) return e.meses === 1 ? '1 mes' : e.meses + ' meses';
    return e.dias === 1 ? '1 día' : e.dias + ' días';
  }
  const CAMPOS_REG = [
    { k: 'hospital', t: 'Hospital que refiere', tipo: 'hospital', ancho: true,
      ayuda: 'Escriba parte del nombre o del lugar ("zacamil", "bloom", "consulta"…). Si no está en la lista, elija "Otro".' },
    { k: 'expediente', t: 'Expediente del paciente', tipo: 'texto', max: 30, mayus: true },
    { k: 'nombre', t: 'Nombre completo del paciente', tipo: 'texto', max: 120 },
    { k: 'fecha_nacimiento', t: 'Fecha de nacimiento o edad', tipo: 'nacimiento', opcional: true },
    { k: 'sexo', t: 'Sexo', tipo: 'radio', op: SEXOS },
    { k: 'motivo', t: 'Motivo del estudio', tipo: 'area', ancho: true, opcional: true },
    { k: 'ekg', t: 'Electrocardiograma', tipo: 'archivo', opcional: true },
    { k: 'rx', t: 'Placa de rayos X', tipo: 'archivo', opcional: true },
    { k: 'peso', t: 'Peso', tipo: 'decimal', enteros: 3, decimales: 2, sufijo: 'kg', opcional: true },
    { k: 'talla', t: 'Talla', tipo: 'decimal', enteros: 3, decimales: 2, sufijo: 'cm', opcional: true },
    { k: 'contacto', t: 'Teléfono de contacto del paciente', tipo: 'telefono', ayuda: 'Si no es de El Salvador, escríbalo con el código de país (+504…).' }
  ];
  function nuevoRegistro() {
    S.registro = { valores: {}, archivos: {}, errores: {}, idCliente: uuid(), agendar: 'ahora', cita: { fecha: '', medico: '', hora: '' },
      cal: { mes: S.hoy.slice(0, 7), medico: '', dia: '' }, resultado: null, sucio: false };
  }
  function validarRegistro() {
    const R = S.registro, v = R.valores, err = {};
    // Fecha de nacimiento o edad: no es obligatoria; si no hay fecha, se revisa la edad escrita.
    if (!String(v.fecha_nacimiento || '').trim() && String(v.edad || '').trim() && !(/^\d{1,3}$/.test(String(v.edad).trim()) && Number(v.edad) <= 120)) {
      err.fecha_nacimiento = 'Escriba la edad en años (0 a 120).';
    }
    CAMPOS_REG.forEach(function (c) {
      const valor = c.tipo === 'archivo' ? R.archivos[c.k] : String(v[c.k] || '').trim();
      if (!valor) { if (!c.opcional) err[c.k] = 'Esta pregunta es obligatoria.'; return; }
      if (c.k === 'hospital' && valor === OTRO && String(v.hospital_otro || '').trim().length < 3) err[c.k] = 'Escriba el nombre del hospital.';
      if (c.k === 'nombre' && valor.length < 3) err[c.k] = 'Escriba el nombre completo.';
      if (c.k === 'expediente' && !/^[A-Za-z0-9][A-Za-z0-9 .\/-]*$/.test(valor)) err[c.k] = 'Use solo números, letras, guion o diagonal.';
      if (c.k === 'fecha_nacimiento') { const e = edadDe(valor); if (!e) err[c.k] = 'Escriba una fecha real y no futura (DD/MM/AAAA), o borre la fecha y escriba solo la edad.'; else if (e.anios > 120) err[c.k] = 'Revise el año de nacimiento.'; }
      if (c.k === 'peso' && !(Number(valor) >= 0.3 && Number(valor) <= 400)) err[c.k] = 'Escriba el peso en kilogramos (0.3 a 400).';
      if (c.k === 'talla') {
        if (Number(valor) > 0 && Number(valor) < 3) err[c.k] = 'Escriba la talla en centímetros: ' + valor + ' m = ' + Math.round(Number(valor) * 100) + ' cm.';
        else if (!(Number(valor) >= 20 && Number(valor) <= 250)) err[c.k] = 'Escriba la talla en centímetros (20 a 250).';
      }
      if (c.k === 'contacto') {
        const n = valor.replace(/\D/g, '').length;
        if (valor.charAt(0) === '+' ? n < 9 || n > 15 : n !== 8) err[c.k] = valor.charAt(0) === '+' ? 'Revise el número: código de país y número completo.' : 'El número debe tener 8 dígitos.';
      }
    });
    if (R.agendar === 'ahora') { const p = validarSt(R.cita); if (p) err.cita = p; }
    return err;
  }
  /** Lista de hospitales con buscador ("Otro" siempre al final). actual() devuelve el valor elegido; poner(v) lo guarda. */
  function buscadorHospital(id, actual, poner) {
    const idLista = id + '-lista';
    const texto = function (v) { return v === OTRO ? OTRO_TEXTO : v || ''; };
    const input = h('input', { id: id, type: 'text', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': idLista, 'aria-autocomplete': 'list',
      autocomplete: 'off', spellcheck: 'false', placeholder: 'Escriba para buscar…', value: texto(actual()) });
    const lista = h('ul', { id: idLista, role: 'listbox', class: 'combo-lista', hidden: true, 'aria-label': 'Hospitales' });
    const btn = h('button', { type: 'button', class: 'combo-btn', tabindex: '-1', 'aria-label': 'Mostrar todos los hospitales' }, '▾');
    let visibles = [], activo = -1;
    const resaltar = function (t, palabras) {
      if (!palabras.length) return t;
      const n = norm(t);
      const marcas = new Array(t.length).fill(false);
      palabras.forEach(function (p) { let i = n.indexOf(p); while (i >= 0) { for (let j = i; j < i + p.length; j++) marcas[j] = true; i = n.indexOf(p, i + p.length); } });
      const partes = [];
      let i = 0;
      while (i < t.length) { let j = i; while (j < t.length && marcas[j] === marcas[i]) j++; partes.push(marcas[i] ? h('mark', null, t.slice(i, j)) : t.slice(i, j)); i = j; }
      return partes;
    };
    const marcarActivo = function () {
      Array.prototype.forEach.call(lista.querySelectorAll('[role=option]'), function (li, i) { li.setAttribute('aria-selected', String(i === activo)); });
      const li = document.getElementById(id + '-op-' + activo);
      if (activo >= 0 && li) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
    };
    const cerrar = function () { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
    const elegir = function (x) { input.value = texto(x); poner(x); cerrar(); };
    const abrir = function (todos) {
      const q = todos ? '' : norm(input.value).replace(/["“”.,]/g, ' ').trim();
      const palabras = q ? q.split(/\s+/).filter(function (p) { return p && p !== 'h' && p !== 'n'; }) : [];
      visibles = S.hospitales.filter(function (x) { const n = norm(x); return palabras.every(function (p) { return n.indexOf(p) >= 0; }); }).concat([OTRO]);
      lista.textContent = '';
      activo = visibles.indexOf(actual());
      if (visibles.length === 1) lista.appendChild(h('li', { class: 'nada', role: 'presentation' }, 'No se encontró ningún hospital con ese texto.'));
      visibles.forEach(function (x, i) {
        lista.appendChild(h('li', { id: id + '-op-' + i, role: 'option', class: (x === actual() ? 'elegido' : '') + (x === OTRO ? ' otro' : ''), 'aria-selected': String(i === activo),
          onpointerdown: function (ev) { ev.preventDefault(); elegir(x); } }, x === OTRO ? OTRO_TEXTO : resaltar(x, palabras)));
      });
      lista.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      marcarActivo();
    };
    input.addEventListener('focus', function () { abrir(input.value === texto(actual())); });
    input.addEventListener('input', function () { if (input.value !== texto(actual())) poner(''); abrir(false); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (lista.hidden) { abrir(false); return; }
        activo = ev.key === 'ArrowDown' ? Math.min(visibles.length - 1, activo + 1) : Math.max(0, activo - 1);
        marcarActivo();
      } else if (ev.key === 'Enter') {
        if (!lista.hidden && visibles.length) { ev.preventDefault(); elegir(visibles[activo >= 0 ? activo : 0]); }
      } else if (ev.key === 'Escape') { cerrar(); }
    });
    input.addEventListener('blur', function () {
      cerrar();
      if (!actual()) {
        const exacto = S.hospitales.concat([OTRO]).filter(function (x) { return norm(texto(x)) === norm(input.value.trim()); })[0];
        if (exacto) elegir(exacto);
      }
    });
    btn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });
    btn.addEventListener('click', function () { if (lista.hidden) { input.focus(); abrir(true); } else cerrar(); });
    return h('div', { class: 'combo' }, input, btn, lista);
  }

  function campoRegistro(c, n) {
    const R = S.registro;
    const id = 'rg-' + c.k;
    const caja = h('div', { class: 'campo' + (c.ancho ? ' ancho' : '') + (R.errores[c.k] ? ' mal' : ''), id: 'campo-' + id });
    const etiqueta = [h('span', { class: 'num' }, n + '.'), c.t, c.opcional ? h('span', { class: 'opc' }, '(opcional)') : null];
    const poner = function (v) { R.valores[c.k] = v; R.sucio = true; if (R.errores[c.k]) { delete R.errores[c.k]; caja.classList.remove('mal'); msg.textContent = ''; } };
    const msg = h('div', { class: 'msg', role: 'alert' }, R.errores[c.k] || '');
    if (c.tipo === 'hospital') {
      const otro = h('input', { type: 'text', id: 'rg-hospital_otro', maxlength: 120, placeholder: 'Escriba el nombre del hospital', value: R.valores.hospital_otro || '',
        'aria-label': 'Nombre del hospital (otro)', oninput: function (ev) { R.valores.hospital_otro = ev.target.value; R.sucio = true; } });
      const cajaOtro = h('div', { style: 'margin-top:8px', hidden: R.valores.hospital !== OTRO }, otro);
      const buscador = buscadorHospital(id, function () { return R.valores.hospital || ''; }, function (v) {
        poner(v);
        cajaOtro.hidden = v !== OTRO;
        if (v === OTRO) setTimeout(function () { otro.focus(); }, 0);
      });
      agregar(caja, [h('label', { for: id }, etiqueta), buscador, cajaOtro]);
    } else if (c.tipo === 'texto') {
      agregar(caja, [h('label', { for: id }, etiqueta), h('input', { type: 'text', id: id, maxlength: c.max, value: R.valores[c.k] || '', autocomplete: 'off',
        autocapitalize: c.mayus ? 'characters' : 'words', spellcheck: c.mayus ? 'false' : null, oninput: function (ev) { poner(ev.target.value); } })]);
    } else if (c.tipo === 'area') {
      const t = h('textarea', { id: id, maxlength: 2000, rows: 3, oninput: function (ev) { poner(ev.target.value); } });
      t.value = R.valores[c.k] || '';
      agregar(caja, [h('label', { for: id }, etiqueta), t]);
    } else if (c.tipo === 'radio') {
      agregar(caja, [h('div', { class: 'etq', id: 'etq-' + id }, etiqueta), h('div', { class: 'opciones dos', role: 'radiogroup', 'aria-labelledby': 'etq-' + id },
        c.op.map(function (o) {
          return h('label', { class: 'opcion' }, h('input', { type: 'radio', name: id, value: o, checked: R.valores[c.k] === o, onchange: function () { poner(o); } }), o);
        }))]);
    } else if (c.tipo === 'decimal' || c.tipo === 'telefono') {
      const inp = h('input', { type: 'text', id: id, inputmode: c.tipo === 'decimal' ? 'decimal' : 'tel', value: R.valores[c.k] || '', autocomplete: 'off',
        placeholder: c.tipo === 'telefono' ? '0000-0000' : '',
        oninput: function (ev) {
          const el = ev.target;
          let v;
          if (c.tipo === 'decimal') {
            v = el.value.replace(',', '.').replace(/[^\d.]/g, '');
            const p = v.split('.');
            v = p[0].slice(0, c.enteros) + (p.length > 1 ? '.' + p.slice(1).join('').slice(0, c.decimales) : '');
          } else v = formatoTelefono(el.value);
          if (v !== el.value) el.value = v;
          poner(v);
        } });
      agregar(caja, [h('label', { for: id }, etiqueta), c.sufijo ? h('div', { class: 'con-sufijo' }, inp, h('span', null, c.sufijo)) : inp]);
    } else if (c.tipo === 'nacimiento') {
      // Se escribe la fecha de nacimiento (la edad se calcula) o, si no se conoce, solo la edad en años.
      const largos = [2, 2, 4], ph = ['DD', 'MM', 'AAAA'], aria = ['Día de nacimiento', 'Mes de nacimiento', 'Año de nacimiento'];
      const previo = String(R.valores[c.k] || '').split('/');
      const entradas = [];
      const calculo = h('div', { class: 'calculo', 'aria-live': 'polite' });
      const edad = h('input', { type: 'text', id: 'rg-edad', inputmode: 'numeric', maxlength: 3, class: 'seg-4', placeholder: 'años', 'aria-label': 'Edad en años',
        value: R.valores.edad || '',
        oninput: function (ev) {
          const v = ev.target.value.replace(/\D/g, '').slice(0, 3);
          if (v !== ev.target.value) ev.target.value = v;
          R.valores.edad = v; R.sucio = true;
          if (R.errores[c.k]) { delete R.errores[c.k]; caja.classList.remove('mal'); msg.textContent = ''; }
          mostrarEdad(); bloquear();
        } });
      const bloquear = function () {
        const conFecha = !!R.valores[c.k], conEdad = !!R.valores.edad;
        entradas.forEach(function (x) { x.disabled = conEdad && !conFecha; });
        edad.disabled = conFecha;
        if (conFecha) { const e = edadDe(R.valores[c.k]); edad.value = e ? String(e.anios) : ''; }
      };
      const mostrarEdad = function () {
        calculo.textContent = '';
        const e = edadDe(R.valores[c.k]);
        if (e) agregar(calculo, ['Edad: ', h('b', null, textoEdad(e))]);
        else if (!R.valores[c.k] && R.valores.edad) agregar(calculo, ['Edad: ', h('b', null, plural(Number(R.valores.edad), 'año', 'años')), ' (sin fecha de nacimiento)']);
        else if (!R.valores[c.k]) calculo.textContent = 'Si no conoce la fecha, escriba solo la edad. Puede quedar en blanco.';
      };
      const actualizar = function () {
        const p = entradas.map(function (x) { return x.value; });
        poner(p.some(Boolean) ? p.join('/') : '');
        if (R.valores[c.k]) R.valores.edad = '';
        mostrarEdad(); bloquear();
      };
      largos.forEach(function (largo, i) {
        const inp = h('input', { type: 'text', inputmode: 'numeric', maxlength: largo, class: 'seg-' + largo, placeholder: ph[i], 'aria-label': aria[i], id: i === 0 ? id : null, value: previo[i] || '',
          oninput: function (ev) {
            const v = ev.target.value.replace(/\D/g, '').slice(0, largo);
            if (v !== ev.target.value) ev.target.value = v;
            actualizar();
            if (v.length === largo && entradas[i + 1]) entradas[i + 1].focus();
          },
          onblur: function (ev) { if (i < 2 && ev.target.value.length === 1) { ev.target.value = '0' + ev.target.value; actualizar(); } },
          onkeydown: function (ev) {
            if ((ev.key === '/' || ev.key === '-' || ev.key === '.') && entradas[i + 1]) { ev.preventDefault(); if (ev.target.value) entradas[i + 1].focus(); }
            if (ev.key === 'Backspace' && !ev.target.value && entradas[i - 1]) entradas[i - 1].focus();
          } });
        entradas.push(inp);
      });
      const grupo = h('div', { class: 'segmentos', role: 'group', 'aria-labelledby': 'etq-' + id });
      entradas.forEach(function (inp, i) { if (i) grupo.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true' }, '/')); grupo.appendChild(inp); });
      grupo.appendChild(h('span', { class: 'o-edad' }, 'o edad'));
      grupo.appendChild(edad);
      mostrarEdad();
      bloquear();
      agregar(caja, [h('div', { class: 'etq', id: 'etq-' + id }, etiqueta), grupo, calculo]);
    } else if (c.tipo === 'archivo') {
      const zona = h('div', { class: 'zona' });
      const pintarZona = function () {
        zona.textContent = '';
        const a = R.archivos[c.k];
        const cambiar = h('button', { type: 'button', class: 'btn chico', onclick: function () {
          elegirArchivo('.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf', async function (file) {
            zona.textContent = 'Preparando archivo…';
            try {
              const blob = await prepararArchivo(file);
              R.archivos[c.k] = { blob: blob, nombre: file.name || 'archivo', vista: /^image\//.test(blob.type) ? URL.createObjectURL(blob) : '' };
              R.sucio = true;
            } catch (e) { tostada(e.message, { error: true }); }
            pintarZona();
          });
        } }, a ? 'Cambiar' : 'Cargar archivo');
        agregar(zona, [a && a.vista ? h('img', { class: 'mini', src: a.vista, alt: '' }) : null,
          h('div', { class: 'info' }, h('b', null, a ? a.nombre : 'Ningún archivo'), h('span', null, a ? Math.max(1, Math.round(a.blob.size / 1024)) + ' KB' : 'Foto o PDF · máximo 8 MB')),
          cambiar, a ? h('button', { type: 'button', class: 'btn chico peligro', onclick: function () { delete R.archivos[c.k]; pintarZona(); } }, 'Quitar') : null]);
      };
      pintarZona();
      agregar(caja, [h('div', { class: 'etq' }, etiqueta), zona]);
    }
    if (c.ayuda) caja.appendChild(h('div', { class: 'ayuda' }, c.ayuda));
    caja.appendChild(msg);
    return caja;
  }

  /** Médicos del día elegido en el calendario del registro: con cupos, llenos o extracurricular. */
  function medicosParaRegistro() {
    const R = S.registro, st = R.cita;
    if (!st.fecha) return h('p', { class: 'tenue', style: 'margin:10px 0 0' }, 'Toque un día del calendario para ver los médicos y sus cupos.');
    const delDia = medicosDelDia(st.fecha).filter(function (x) { return x.cupos > 0; });
    const elegir = function (m) { st.medico = m; st.hora = cuposDia(st.fecha, m).hora; delete R.errores.cita; pintar(); };
    const otros = medicosActivos().filter(function (m) { return !delDia.some(function (x) { return x.medico === m; }); });
    return h('div', null,
      h('h4', { style: 'margin:14px 0 4px' }, 'Médicos del ' + fechaLarga(st.fecha)),
      h('div', { class: 'medicos-dia' },
        delDia.map(function (x) {
          return h('button', { type: 'button', class: 'medico-op ' + (x.libres ? 'libre' : 'lleno'), 'aria-pressed': String(st.medico === x.medico), onclick: function () { elegir(x.medico); } },
            h('b', null, x.medico), h('small', null, x.usados + ' de ' + x.cupos + ' cupos ocupados' + (x.libres ? ' · ' + plural(x.libres, 'libre', 'libres') : ' · lleno (sobrecupo)') + ' · ' + hora12(x.hora)));
        }),
        otros.map(function (m) {
          const n = usados(st.fecha, m);
          return h('button', { type: 'button', class: 'medico-op extra', 'aria-pressed': String(st.medico === m), onclick: function () { elegir(m); } },
            h('b', null, m), h('small', null, 'Sin cupos ese día · extracurricular' + (n ? ' (ya hay ' + n + ')' : '')));
        })),
      st.medico ? h('div', { class: 'fila', style: 'margin-top:10px;display:flex;gap:10px;align-items:end;flex-wrap:wrap' },
        h('div', { class: 'campo', style: 'margin:0;flex:0 1 160px' }, h('label', { for: 'rg-hora' }, 'Hora'),
          h('input', { type: 'time', id: 'rg-hora', value: st.hora, step: 300, onchange: function (ev) { st.hora = ev.target.value; pintar(); } }))) : null,
      st.medico ? h('div', { class: 'resumen-cita' }, 'Cita: ', h('b', null, fechaLarga(st.fecha) + ' · ' + hora12(st.hora) + ' · ' + st.medico),
        cuposDia(st.fecha, st.medico).cupos === 0 ? h('div', { class: 'tenue', style: 'margin-top:4px' }, 'Paciente extracurricular: se pedirá confirmar al guardar.')
          : usados(st.fecha, st.medico) >= cuposDia(st.fecha, st.medico).cupos ? h('div', { class: 'tenue', style: 'margin-top:4px' }, 'Cupos completos: se pedirá confirmar el sobrecupo al guardar.') : null) : null);
  }

  function vistaRegistro(main) {
    if (!S.registro) nuevoRegistro();
    const R = S.registro;
    if (R.resultado) { pintarResultadoRegistro(main); return; }
    const err = cajaError();
    const rejilla = h('div', { class: 'form-reg' });
    CAMPOS_REG.forEach(function (c, i) { rejilla.appendChild(campoRegistro(c, i + 1)); });
    R.cal.dia = R.cita.fecha;
    const cal = calendario(R.cal, { soloFuturo: true, titulo: 'Elija el día', ayuda: 'Toque un día para elegirlo.',
      alElegir: function (fecha) {
        R.cita.fecha = fecha; R.cita.medico = '';
        // Se propone el primer médico con cupos libres ese día (o el del filtro del calendario).
        const op = medicosDelDia(fecha).filter(function (x) { return x.libres > 0 && (!R.cal.medico || x.medico === R.cal.medico); })[0];
        if (op) { R.cita.medico = op.medico; R.cita.hora = op.hora; }
        delete R.errores.cita; pintar();
      } });
    const btn = h('button', { class: 'btn primario', type: 'button', style: 'min-width:220px', onclick: function (ev) { guardarRegistro(ev.currentTarget, err); } },
      R.agendar === 'ahora' ? 'Registrar y agendar' : 'Registrar solicitud');
    agregar(main, [
      h('div', { class: 'cab' }, h('h2', null, 'Registro manual de solicitud'),
        h('span', { class: 'estado-form' }, 'Ecocardiograma · las preguntas marcadas "opcional" pueden quedar en blanco.')),
      h('section', { class: 'panel' }, h('h3', null, 'Datos del paciente'), rejilla),
      h('section', { class: 'panel', id: 'campo-rg-cita' }, h('h3', null, 'Cita'),
        h('div', { class: 'agendar-op', role: 'radiogroup', 'aria-label': 'Cuándo agendar' },
          h('label', { class: 'opcion' }, h('input', { type: 'radio', name: 'rg-agendar', checked: R.agendar === 'ahora', onchange: function () { R.agendar = 'ahora'; pintar(); } }), 'Agendar ahora'),
          h('label', { class: 'opcion' }, h('input', { type: 'radio', name: 'rg-agendar', checked: R.agendar === 'despues', onchange: function () { R.agendar = 'despues'; delete R.errores.cita; pintar(); } }), 'Agendar después')),
        R.agendar === 'despues' ? h('p', { class: 'tenue', style: 'margin:10px 0 0' }, 'La solicitud quedará en "Asignación de citas", pestaña "Por agendar".') : null,
        R.errores.cita ? h('div', { class: 'aviso error' }, R.errores.cita) : null),
      R.agendar === 'ahora' ? cal : null,
      R.agendar === 'ahora' ? h('section', { class: 'panel' }, medicosParaRegistro()) : null,
      err,
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 20px' }, btn,
        h('button', { class: 'btn', type: 'button', onclick: async function () {
          if (R.sucio && !(await preguntar('¿Borrar lo escrito?', 'Se perderán los datos de este registro.', 'Sí, borrar', 'Cancelar', 'peligro'))) return;
          nuevoRegistro(); pintar(); window.scrollTo(0, 0);
        } }, 'Limpiar'))
    ]);
  }

  async function guardarRegistro(btn, err, confirmado) {
    const R = S.registro;
    err.textContent = '';
    R.errores = validarRegistro();
    const claves = Object.keys(R.errores);
    if (claves.length) {
      pintar();
      const primero = document.getElementById('campo-rg-' + claves[0]);
      if (primero) primero.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tostada(claves.length === 1 ? 'Falta 1 dato por corregir.' : 'Faltan ' + claves.length + ' datos por corregir.', { error: true });
      return;
    }
    let conf = null;
    if (R.agendar === 'ahora') {
      conf = confirmado || await confirmarCita(R.cita, '');
      if (!conf) return;
    }
    try {
      const r = await conBoton(btn, async function () {
        const datos = {};
        CAMPOS_REG.forEach(function (c) { if (c.tipo !== 'archivo') datos[c.k] = String(R.valores[c.k] || '').trim(); });
        datos.hospital_otro = datos.hospital === OTRO ? String(R.valores.hospital_otro || '').trim() : '';
        datos.edad = datos.fecha_nacimiento ? '' : String(R.valores.edad || '').trim();
        const cuerpo = { datos: datos, id_cliente: R.idCliente };
        for (const k of ['ekg', 'rx']) if (R.archivos[k]) cuerpo[k] = { b64: await aBase64(R.archivos[k].blob) };
        if (conf) cuerpo.cita = { fecha: R.cita.fecha, hora: R.cita.hora, medico: R.cita.medico, sobrecupo: conf.sobrecupo, extracurricular: conf.extracurricular };
        return api('registro.crear', cuerpo);
      });
      const f = aplicarFila(r);
      R.resultado = f.id;
      R.sucio = false;
      pintar();
      window.scrollTo(0, 0);
    } catch (e) {
      if ((e.code === 'SIN_CUPO' || e.code === 'EXTRACURRICULAR') && e.datos) {
        const c2 = await confirmarCita(R.cita, '', e.datos);
        if (c2) guardarRegistro(btn, err, c2);
        return;
      }
      mostrarError(err, e);
      err.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function pintarResultadoRegistro(main) {
    const f = S.filas.get(S.registro.resultado);
    if (!f) { nuevoRegistro(); vistaRegistro(main); return; }
    main.appendChild(h('section', { class: 'panel exito-reg' },
      h('div', { class: 'check', 'aria-hidden': 'true' }, '✓'),
      h('h2', { style: 'margin:0' }, 'Solicitud registrada'),
      h('div', { class: 'folio' }, f.id),
      h('p', { style: 'margin:4px 0 0' }, h('b', null, f.nombre), ' · Exp. ' + f.expediente + ' · ' + hospCorto(f.hospital)),
      f.cita_fecha ? h('div', { class: 'resumen-cita', style: 'max-width:560px;margin:14px auto 0' }, 'Cita: ', h('b', null, fechaLarga(f.cita_fecha) + ' · ' + hora12(f.cita_hora) + ' · ' + f.cita_medico), ' ', chipTipo(f))
        : h('p', { class: 'tenue' }, 'Sin cita: queda en "Asignación de citas" → "Por agendar".'),
      f.cita_fecha ? h('div', { style: 'max-width:560px;margin:12px auto 0;text-align:left' }, bloqueNotificar(f)) : null,
      h('div', { class: 'botones' },
        h('button', { class: 'btn', onclick: function () { abrirDetalle(f); } }, 'Ver solicitud'),
        h('button', { class: 'btn primario', onclick: function () { nuevoRegistro(); pintar(); window.scrollTo(0, 0); } }, 'Registrar otra'))));
  }

  /* ============================== censo general ============================== */
  function uiCenso() {
    return ui('censo', { orden: 'fecha', dir: -1, hosp: '', estado: '', medico: '', origen: '', reporte: '', desde: sumarDias(S.hoy || new Date().toISOString().slice(0, 10), -30), hasta: S.hoy || '' });
  }
  function vistaCenso(main) {
    const u = uiCenso();
    const ordenes = ['fecha', 'cita', 'medico', 'nombre', 'edad', 'hospital'];
    const enRango = filasArr().filter(function (f) {
      // "Citas pasadas sin marcar" mira la fecha de la cita, no la de la solicitud.
      if (u.estado === 'VENCIDA') return true;
      return (!u.desde || f.fecha >= u.desde) && (!u.hasta || f.fecha <= u.hasta);
    });
    const filas = enRango.filter(function (f) {
      return (!u.hosp || f.hospital === u.hosp) && (!u.origen || f.origen === u.origen) &&
        (!u.medico || (u.medico === '-' ? !f.cita_medico : f.cita_medico === u.medico)) &&
        (!u.estado || (u.estado === 'NO_ACUDIO' ? f.motivo_no === NO_ACUDIO : u.estado === 'VENCIDA' ? f.estado === 'PENDIENTE' && f.cita_fecha && f.cita_fecha < S.hoy
          : u.estado === 'EXTRA' ? f.tipo_cupo === TIPO_EXTRA : f.estado === u.estado)) &&
        (!u.reporte || (u.reporte === 'revisar' ? f.reporte_estado === 'POR REVISAR' : u.reporte === 'sin' ? !f.reporte : reporteListo(f)));
    });
    const visibles = aplicar(filas, u);
    const err = cajaError();
    const pedir = async function (desde, btn) {
      try {
        await conBoton(btn, function () { return cargarAntiguos(desde); });
        u.desde = desde === '0000-01-01' ? '' : desde;
        pintar();
      } catch (e) { mostrarError(err, e); }
    };
    const filtro = function (id, etiqueta, control) { return h('div', { class: 'campo chico' }, h('label', { for: id }, etiqueta), control); };
    const extra = [
      filtro('f-desde', 'Desde', h('input', { type: 'date', id: 'f-desde', value: u.desde, max: S.hoy, onchange: function (ev) {
        const v = ev.target.value;
        if (v && S.desde && v < S.desde) pedir(v, ev.target); else { u.desde = v; pintar(); }
      } })),
      filtro('f-hasta', 'Hasta', h('input', { type: 'date', id: 'f-hasta', value: u.hasta, max: S.hoy, onchange: function (ev) { u.hasta = ev.target.value; pintar(); } })),
      filtroSelect('f-hosp', 'Hospital', opcionesHospital(enRango), u.hosp, function (v) { u.hosp = v; }),
      filtroSelect('f-medico', 'Médico de la cita', opcionesMedico(true), u.medico, function (v) { u.medico = v; }),
      filtroSelect('f-estado', 'Estado', [['', 'Todos'], ['PENDIENTE', 'Pendiente'], ['REALIZADO', 'Realizado'], ['NO REALIZADO', 'No realizado'], ['NO_ACUDIO', 'Paciente no acudió'],
        ['VENCIDA', 'Cita pasada sin marcar'], ['EXTRA', 'Extracurricular']], u.estado, function (v) { u.estado = v; }),
      filtroSelect('f-origen', 'Origen', [['', 'Todos'], ['FORMULARIO', 'Formulario'], ['MANUAL', 'Registro manual']], u.origen, function (v) { u.origen = v; }),
      filtroSelect('f-reporte', 'Reporte', [['', 'Todos'], ['con', 'Con reporte'], ['sin', 'Sin reporte'], ['revisar', 'Por revisar']], u.reporte, function (v) { u.reporte = v; })
    ];
    agregar(main, [
      h('div', { class: 'cab' }, h('h2', null, 'Censo de solicitudes'),
        h('button', { class: 'btn no-imprimir', onclick: function (ev) { pedir('0000-01-01', ev.currentTarget); } }, 'Cargar todo el historial'),
        h('button', { class: 'btn oscuro no-imprimir', onclick: function () { exportarCsv(visibles); } }, 'Descargar (CSV)')),
      err,
      controles(u, ordenes, extra),
      tabla(visibles, u, { ordenes: ordenes, columnas: ['marcar', 'solicitud', 'paciente', 'edad', 'hospital', 'citaTexto'], vacio: 'No hay solicitudes con estos filtros.' }),
      h('p', { class: 'no-imprimir', style: 'color:#51606f;font-size:13.5px' }, S.desde > '0000-01-01' ? 'Datos cargados desde el ' + fechaCorta(S.desde) + '. Para ver fechas anteriores, cambie "Desde" o use "Cargar todo el historial".' : 'Historial completo cargado.')
    ]);
  }

  function descargar(nombre, texto) {
    const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: nombre });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function celdaCsv(v) {
    let s = String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@\t]/.test(s)) s = "'" + s; // evita que Excel lo interprete como fórmula
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportarCsv(filas) {
    if (!filas.length) { tostada('No hay filas para descargar.'); return; }
    if (!confirm('El archivo contendrá datos de ' + plural(filas.length, 'paciente', 'pacientes') + '. Guárdelo solo en un equipo institucional. ¿Descargar?')) return;
    const cols = [['id', 'Solicitud'], ['fecha_hora', 'Fecha y hora'], ['origen', 'Origen'], ['registrado_por', 'Registrado por'], ['hospital', 'Hospital que refiere'],
      ['nombre', 'Paciente'], ['expediente', 'Expediente'], ['fecha_nacimiento', 'Fecha de nacimiento'], ['edad', 'Edad'], ['sexo', 'Sexo'], ['peso', 'Peso (kg)'], ['talla', 'Talla (cm)'],
      ['motivo', 'Motivo del estudio'], ['contacto', 'Teléfono del paciente'], ['ts_nombre', 'Trabajo Social'], ['ts_contacto', 'Teléfono de Trabajo Social'],
      ['cita_fecha', 'Fecha de cita'], ['cita_hora', 'Hora de cita'], ['cita_medico', 'Médico de la cita'], ['tipo_cupo', 'Tipo de cupo'], ['notificado', 'Notificado'],
      ['estado', 'Estado'], ['realizado_por', 'Realizado por'], ['motivo_no', 'Motivo de no realización'], ['fecha_cierre', 'Fecha de cierre'],
      ['reporte_estado', 'Reporte'], ['comentario', 'Comentario'], ['comentario_por', 'Comentario guardado por']];
    const lineas = [cols.map(function (c) { return celdaCsv(c[1]); }).join(',')];
    filas.forEach(function (f) { lineas.push(cols.map(function (c) { return celdaCsv(f[c[0]]); }).join(',')); });
    descargar('censo_compras_' + S.hoy + '.csv', lineas.join('\r\n'));
  }


  /* ============================== censos de compra de servicios ============================== */
  /*
   * Censo diario del formato del Ministerio ("Pruebas funcionales"): un documento por día y por médico, con los
   * pacientes a los que ese médico les REALIZÓ el estudio. Nunca se juntan dos días en un documento; si un día
   * pasa de 15 pacientes, el mismo documento sigue en otra hoja (16, 17…). El Word se arma en el navegador a partir
   * del formato oficial (plantilla-censo.js), así que conserva exactamente su diseño.
   */
  function recalcularNombres() {
    const m = {};
    (S.usuarios || []).forEach(function (x) { if (x.rol === 'medico' && x.medico && x.activo && !m[x.medico]) m[x.medico] = x.nombre; });
    S.nombresMedicos = m;
  }
  function nombreCompleto(medico) { return S.nombresMedicos[medico] || medico; }
  /** Fecha del estudio: la de la cita (aunque se marque otro día). */
  function fechaEstudio(f) { return f.cita_fecha || String(f.fecha_cierre || '').slice(0, 10); }
  function sinTildes(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function nombreArchivo(t) { return sinTildes(t).replace(/[^A-Za-z0-9.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); }

  let promesaPlantilla = null;
  function cargarPlantilla() {
    if (window.PLANTILLA_CENSO) return Promise.resolve(window.PLANTILLA_CENSO);
    if (!promesaPlantilla) {
      promesaPlantilla = new Promise(function (ok, mal) {
        const sc = document.createElement('script');
        sc.src = 'plantilla-censo.js';
        sc.onload = function () { window.PLANTILLA_CENSO ? ok(window.PLANTILLA_CENSO) : mal(new Error('El formato del censo no se cargó.')); };
        sc.onerror = function () { promesaPlantilla = null; mal(new Error('No se pudo cargar el formato del censo. Revise la conexión.')); };
        document.head.appendChild(sc);
      });
    }
    return promesaPlantilla;
  }

  /* ---- ZIP mínimo (sin compresión): un .docx es un ZIP con archivos XML ---- */
  let tablaCrc = null;
  function crc32(bytes) {
    if (!tablaCrc) {
      tablaCrc = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tablaCrc[n] = c >>> 0; }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = tablaCrc[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function crearZip(archivos) {
    const enc = new TextEncoder();
    const ahora = new Date();
    const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
    const fecha = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
    const locales = [], centrales = [];
    let desplazamiento = 0;
    archivos.forEach(function (a) {
      const nombre = enc.encode(a.nombre);
      const datos = typeof a.datos === 'string' ? enc.encode(a.datos) : a.datos;
      const crc = crc32(datos);
      const l = new DataView(new ArrayBuffer(30));
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true);
      l.setUint16(10, hora, true); l.setUint16(12, fecha, true); l.setUint32(14, crc, true);
      l.setUint32(18, datos.length, true); l.setUint32(22, datos.length, true); l.setUint16(26, nombre.length, true); l.setUint16(28, 0, true);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, hora, true); c.setUint16(14, fecha, true); c.setUint32(16, crc, true); c.setUint32(20, datos.length, true); c.setUint32(24, datos.length, true);
      c.setUint16(28, nombre.length, true); c.setUint32(42, desplazamiento, true);
      locales.push(new Uint8Array(l.buffer), nombre, datos);
      centrales.push(new Uint8Array(c.buffer), nombre);
      desplazamiento += 30 + nombre.length + datos.length;
    });
    const tamCentral = centrales.reduce(function (s, x) { return s + x.length; }, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, desplazamiento, true);
    const partes = locales.concat(centrales, [new Uint8Array(fin.buffer)]);
    const out = new Uint8Array(partes.reduce(function (s, x) { return s + x.length; }, 0));
    let i = 0;
    partes.forEach(function (x) { out.set(x, i); i += x.length; });
    return out;
  }
  function xml(t) { return String(t === undefined || t === null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /** Texto de una celda (Arial 8, como el resto del formato). */
  function runCelda(t) {
    if (t === '' || t === undefined || t === null) return '';
    return '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="Arial" w:hAnsi="Arial"/><w:color w:val="000000"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">' + xml(t) + '</w:t></w:r>';
  }
  /** Filas del censo de un día: [fecha, hospital, expediente, nombre, edad, sexo] */
  function filasCenso(pacientes) {
    return pacientes.map(function (f) {
      return [fechaCorta(fechaEstudio(f)), f.hospital, f.expediente, f.nombre, f.edad === '' ? '' : String(Number(f.edad)), f.sexo ? f.sexo.charAt(0).toUpperCase() : ''];
    });
  }
  /** Documento Word del censo de UN día y UN médico. */
  function documentoCenso(P, medico, pacientes) {
    const filas = filasCenso(pacientes);
    const hojas = Math.max(1, Math.ceil(filas.length / P.filas));
    const bloques = [];
    for (let hj = 0; hj < hojas; hj++) {
      const base = hj * P.filas;
      bloques.push(P.bloque
        .replace('{{MEDICO}}', xml(nombreCompleto(medico)))
        .replace(/\{\{N(\d+)\}\}/g, function (m, k) { return String(base + Number(k)); })
        .replace(/\{\{C(\d+)_(\d+)\}\}/g, function (m, k, j) { const f = filas[base + Number(k) - 1]; return f ? runCelda(f[Number(j) - 1]) : ''; }));
    }
    const salto = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const documento = P.inicio + bloques.join(salto) + P.fin;
    return crearZip(P.archivos.map(function (a) { return { nombre: a[0], datos: a[1] }; }).concat([{ nombre: 'word/document.xml', datos: documento }]));
  }
  function bajar(nombre, bytes, tipo) {
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    const a = h('a', { href: url, download: nombre });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  const TIPO_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  function archivoCenso(g) { return 'Censo_' + fechaCorta(g.fecha).replace(/\//g, '-') + '_' + nombreArchivo(g.medico) + '.docx'; }
  async function descargarCenso(g, btn) {
    try {
      const P = await conBoton(btn, cargarPlantilla);
      bajar(archivoCenso(g), documentoCenso(P, g.medico, g.pacientes), TIPO_DOCX);
    } catch (e) { tostada(e.message, { error: true }); }
  }
  async function descargarMes(grupos, mes, medico, btn) {
    try {
      const P = await conBoton(btn, cargarPlantilla);
      const zip = crearZip(grupos.map(function (g) { return { nombre: archivoCenso(g), datos: documentoCenso(P, g.medico, g.pacientes) }; }));
      bajar('Censos_' + mes + '_' + (medico ? nombreArchivo(medico) : 'todos_los_medicos') + '.zip', zip, 'application/zip');
    } catch (e) { tostada(e.message, { error: true }); }
  }

  function vistaCensosCompra(main) {
    const u = ui('compra', { mes: (S.hoy || new Date().toISOString().slice(0, 10)).slice(0, 7), medico: '', abierto: '' });
    if (esMedico()) u.medico = miMedico();
    if (esMedico() && !miMedico()) {
      main.appendChild(h('div', { class: 'aviso alerta' }, 'Su usuario no está vinculado a ningún médico de la lista. Pida al administrador que lo vincule en "Usuarios y médicos".'));
      return;
    }
    const inicioMes = u.mes + '-01';
    if (S.desde && inicioMes < S.desde) {
      main.appendChild(h('div', { class: 'vacio' }, 'Cargando los estudios de ese mes…'));
      cargarAntiguos(inicioMes).then(function () { if (ruta()[0] === 'censos-compra') pintar(); }).catch(function (e) { tostada(e.message, { error: true }); });
      return;
    }
    const delMes = function (f) { return fechaEstudio(f).slice(0, 7) === u.mes; };
    const realizados = filasArr().filter(function (f) { return f.estado === 'REALIZADO' && f.realizado_por && delMes(f) && (!u.medico || f.realizado_por === u.medico); });
    const mapa = {};
    realizados.forEach(function (f) { const k = fechaEstudio(f) + '|' + f.realizado_por; (mapa[k] = mapa[k] || { fecha: fechaEstudio(f), medico: f.realizado_por, pacientes: [] }).pacientes.push(f); });
    const grupos = Object.keys(mapa).sort().map(function (k) {
      const g = mapa[k];
      g.pacientes.sort(function (a, b) { return cmp(a.cita_hora, b.cita_hora) || a.nombre.localeCompare(b.nombre, 'es'); });
      return g;
    });
    const sinMarcar = filasArr().filter(function (f) {
      return f.estado === 'PENDIENTE' && f.cita_fecha && f.cita_fecha < S.hoy && f.cita_fecha.slice(0, 7) === u.mes && (!u.medico || f.cita_medico === u.medico);
    }).length;
    const sinNombre = Array.from(new Set(grupos.map(function (g) { return g.medico; }))).filter(function (m) { return !S.nombresMedicos[m]; });
    const opMedicos = [['', 'Todos los médicos']].concat(S.medicos.map(function (m) { return [m.nombre, m.nombre]; }));
    const total = realizados.length;
    agregar(main, [
      h('div', { class: 'cab' }, h('h2', null, 'Censos de ' + MESES[Number(u.mes.slice(5)) - 1] + ' de ' + u.mes.slice(0, 4)),
        h('div', { class: 'campo no-imprimir', style: 'margin:0;flex:0 0 170px' }, h('label', { for: 'cc-mes' }, 'Mes'),
          h('input', { type: 'month', id: 'cc-mes', value: u.mes, max: S.hoy.slice(0, 7), onchange: function (ev) { if (ev.target.value) { u.mes = ev.target.value; u.abierto = ''; pintar(); } } })),
        !esMedico() ? h('div', { class: 'campo no-imprimir', style: 'margin:0;flex:0 0 220px' }, h('label', { for: 'cc-medico' }, 'Médico'),
          selector(opMedicos, u.medico, { id: 'cc-medico', onchange: function (ev) { u.medico = ev.target.value; u.abierto = ''; pintar(); } })) : null,
        grupos.length ? h('button', { class: 'btn oscuro', onclick: function (ev) { descargarMes(grupos, u.mes, u.medico, ev.currentTarget); } },
          'Descargar todo el mes (' + plural(grupos.length, 'documento', 'documentos') + ', .zip)') : null),
      h('p', { class: 'ayuda-tab' }, 'Un documento de Word por día' + (u.medico ? '' : ' y por médico') + ', en el formato del Ministerio, con los pacientes marcados como realizados en la agenda. Nunca se juntan dos días; si un día pasa de 15 pacientes, el documento sigue en una segunda hoja.'),
      sinMarcar ? h('a', { class: 'aviso alerta aviso-enlace', href: '#/censo', onclick: function () {
        Object.assign(uiCenso(), { reporte: '', q: '', hosp: '', estado: 'VENCIDA', medico: u.medico, origen: '' });
      } }, h('b', null, plural(sinMarcar, 'cita de este mes sigue', 'citas de este mes siguen') + ' sin marcar.'), ' No aparecen en el censo hasta que se marquen como realizadas en la agenda. Toque aquí para verlas.') : null,
      sinNombre.length ? h('div', { class: 'aviso alerta' }, 'Sin nombre completo: ' + sinNombre.join(', ') + '. El censo dirá solo ese nombre. Para que salga completo, cree el usuario del médico (o vincúlelo) en "Usuarios y médicos": se usa su "Nombre".') : null,
      grupos.length ? h('div', { class: 'tabla-caja' }, h('div', { class: 'tabla-scroll' }, h('table', { class: 'censo censos-compra' },
        h('thead', null, h('tr', null, h('th', null, 'Día'), h('th', null, 'Médico'), h('th', null, 'Pacientes'), h('th', null, ''))),
        h('tbody', null, grupos.map(function (g) {
          const k = g.fecha + '|' + g.medico;
          const abierto = u.abierto === k;
          const filas = [h('tr', { class: abierto ? 'abierta' : '', tabindex: '0', onclick: function () { u.abierto = abierto ? '' : k; pintar(); } },
            h('td', { 'data-e': 'Día' }, h('b', null, fechaLarga(g.fecha))),
            h('td', { 'data-e': 'Médico' }, nombreCompleto(g.medico)),
            h('td', { 'data-e': 'Pacientes' }, plural(g.pacientes.length, 'paciente', 'pacientes') + (g.pacientes.length > 15 ? ' (2 hojas)' : ''), h('span', { class: 'fl' }, abierto ? ' ▲' : ' ▼')),
            h('td', { class: 'c-accion' }, h('button', { class: 'btn primario chico', onclick: function (ev) { ev.stopPropagation(); descargarCenso(g, ev.currentTarget); } }, 'Descargar Word')))];
          if (abierto) {
            filas.push(h('tr', { class: 'plegable' }, h('td', { colspan: '4' }, h('table', { class: 'cruce previa-censo' },
              h('thead', null, h('tr', null, ['N°', 'Fecha', 'Nombre del hospital', 'Expediente', 'Nombre completo del paciente', 'Edad', 'Sexo'].map(function (t) { return h('th', null, t); }))),
              h('tbody', null, filasCenso(g.pacientes).map(function (x, i) { return h('tr', null, h('td', null, i + 1), x.map(function (v) { return h('td', null, v); })); }))))));
          }
          return filas;
        })))),
        h('div', { class: 'pie-tabla' }, h('span', null, plural(total, 'estudio realizado', 'estudios realizados') + ' en ' + plural(grupos.length, 'censo', 'censos')))) :
        h('div', { class: 'tabla-caja' }, h('div', { class: 'vacio' }, S.sincronizado ? 'No hay estudios marcados como realizados ' + (u.medico ? 'por ' + u.medico + ' ' : '') + 'en este mes.' : 'Cargando…'))
    ]);
  }

  /* ============================== control de cupos ============================== */
  function vistaCupos(main) {
    if (!S.cupos) {
      main.appendChild(h('div', { class: 'vacio' }, 'Cargando configuración…'));
      api('cupos.obtener').then(function (r) { S.cupos = r; S.config = r.config; if (ruta()[0] === 'cupos') pintar(); })
        .catch(function (e) { if (ruta()[0] === 'cupos') { main.textContent = ''; main.appendChild(h('div', { class: 'aviso error' }, e.message)); } });
      return;
    }
    const edita = esGestion();
    const c = S.cupos.config;
    const b = S.cupos.borrador || (S.cupos.borrador = {
      semana: c.semana.map(function (s) { return { dia: s.dia, medico: s.medico, cupos: s.cupos, hora: s.hora }; }),
      formulario: { activo: c.formulario.activo, mensaje: c.formulario.mensaje || '', codigo: c.formulario.codigo || '' }
    });
    const err = cajaError();
    const nombres = S.medicos.map(function (m) { return m.nombre; });
    const activo = function (m) { return S.medicos.some(function (x) { return x.nombre === m && x.activo; }); };
    const dias = NOMBRES_DIA.map(function (nombre, i) {
      const d = i + 1;
      const turnos = b.semana.filter(function (s) { return s.dia === d; });
      const total = turnos.reduce(function (s, t) { return s + (activo(t.medico) ? Number(t.cupos || 0) : 0); }, 0);
      const caja = h('div', { class: 'dia-semana' + (turnos.length ? '' : ' vacio-dia') },
        h('div', { class: 'nom' }, nombre.charAt(0).toUpperCase() + nombre.slice(1), h('small', null, turnos.length ? plural(total, 'cupo', 'cupos') : 'Sin cupos')));
      const lista = h('div', { class: 'turnos' });
      turnos.forEach(function (t) {
        if (!edita) {
          lista.appendChild(h('div', { class: 'turno-texto' }, h('b', null, t.medico), ' · ' + plural(Number(t.cupos), 'cupo', 'cupos') + ' · ' + hora12(t.hora) + (activo(t.medico) ? '' : ' (médico inactivo)')));
          return;
        }
        const j = b.semana.indexOf(t);
        lista.appendChild(h('div', { class: 'turno' },
          selector(nombres.map(function (m) { return [m, m + (activo(m) ? '' : ' (inactivo)')]; }), t.medico,
            { 'aria-label': 'Médico del ' + nombre, onchange: function (ev) { t.medico = ev.target.value; } }),
          h('span', { class: 'et' }, 'Cupos'),
          h('input', { type: 'text', inputmode: 'numeric', maxlength: 2, value: String(t.cupos), 'aria-label': 'Cupos de ' + t.medico + ' el ' + nombre, id: 'cs-' + d + '-' + j,
            oninput: function (ev) { ev.target.value = ev.target.value.replace(/\D/g, ''); t.cupos = ev.target.value === '' ? 0 : Number(ev.target.value); } }),
          h('span', { class: 'et' }, 'Hora'),
          h('input', { type: 'time', value: t.hora, 'aria-label': 'Hora habitual de ' + t.medico + ' el ' + nombre, onchange: function (ev) { t.hora = ev.target.value; } }),
          h('button', { type: 'button', class: 'btn chico peligro', 'aria-label': 'Quitar a ' + t.medico + ' del ' + nombre, onclick: function () { b.semana.splice(b.semana.indexOf(t), 1); pintar(); } }, 'Quitar')));
      });
      if (edita) {
        const libres = nombres.filter(function (m) { return activo(m) && !turnos.some(function (t) { return t.medico === m; }); });
        if (libres.length) lista.appendChild(h('div', null, h('button', { type: 'button', class: 'btn chico', onclick: function () {
          b.semana.push({ dia: d, medico: libres[0], cupos: 10, hora: (c.hora_inicial || '07:00') }); pintar();
        } }, '+ Agregar médico este día')));
      }
      if (!turnos.length && !edita) lista.appendChild(h('div', { class: 'turno-texto tenue' }, 'No se agendan citas este día (solo extracurriculares).'));
      caja.appendChild(lista);
      return caja;
    });

    const aplicarRespuesta = function (r, mensaje) { S.cupos = r; S.config = r.config; pintar(); if (mensaje) tostada(mensaje); };
    const fecha = h('input', { type: 'date', id: 'sc-fecha', min: S.hoy });
    const medico = selector([['TODOS', 'Todos los médicos']].concat(nombres.map(function (m) { return [m, m]; })), 'TODOS', { id: 'sc-medico' });
    const motivo = h('input', { type: 'text', id: 'sc-motivo', maxlength: 80, placeholder: 'Ej. asueto, congreso, vacaciones' });
    const futuras = c.sin_cupo.filter(function (x) { return x.fecha >= S.hoy; });
    const guardar = async function (ev) {
      err.textContent = '';
      try {
        const r = await conBoton(ev.currentTarget, function () { return api('cupos.guardar', { semana: b.semana, formulario: b.formulario }); });
        aplicarRespuesta(r, 'Configuración guardada.');
      } catch (e) { mostrarError(err, e); }
    };
    agregar(main, [
      h('div', { class: 'cab' }, h('h2', null, 'Control de cupos')),
      !edita ? h('div', { class: 'aviso info' }, 'Solo Trabajo Social y los administradores pueden cambiar esta configuración. Usted puede consultarla.') : null,
      h('section', { class: 'panel' }, h('h3', null, 'Cupos por día y médico'),
        h('p', { class: 'sub' }, 'Cuántos pacientes puede ver cada médico cada día de la semana, y la hora habitual de sus citas (se puede cambiar en cada cita). Se puede agendar en cualquier otro día o con otro médico, pero la app avisará: "está agendando paciente extracurricular".'),
        h('div', { class: 'agenda-semana' }, dias)),
      edita ? h('section', { class: 'panel' }, h('h3', null, 'Formulario de solicitud'),
        h('p', { class: 'sub' }, 'El formulario de Trabajo Social está abierto siempre, salvo que lo desactive aquí (por ejemplo, en vacaciones del servicio).'),
        h('div', { class: 'fila-form' },
          h('label', { class: 'interruptor', style: 'flex:0 0 auto;min-height:42px' }, h('input', { type: 'checkbox', checked: b.formulario.activo, onchange: function (ev) { b.formulario.activo = ev.target.checked; } }), 'Recibir solicitudes'),
          h('div', { class: 'campo', style: 'flex:3 1 260px' }, h('label', { for: 'fo-msg' }, 'Mensaje cuando está desactivado'),
            h('input', { type: 'text', id: 'fo-msg', maxlength: 200, value: b.formulario.mensaje, placeholder: 'Ej. Se reanuda el lunes 5 de enero.', oninput: function (ev) { b.formulario.mensaje = ev.target.value; } })),
          h('div', { class: 'campo', style: 'flex:1 1 160px' }, h('label', { for: 'fo-cod' }, 'Código de acceso (opcional)'),
            h('input', { type: 'text', id: 'fo-cod', maxlength: 20, value: b.formulario.codigo, autocomplete: 'off', placeholder: 'Sin código', oninput: function (ev) { b.formulario.codigo = ev.target.value; } })))) : null,
      err,
      edita ? h('div', { style: 'margin:-4px 0 18px;display:flex;gap:10px;flex-wrap:wrap' },
        h('button', { class: 'btn primario', onclick: guardar }, 'Guardar cambios'),
        h('button', { class: 'btn', onclick: function () { S.cupos.borrador = null; pintar(); } }, 'Descartar')) : null,
      h('section', { class: 'panel' }, h('h3', null, 'Fechas sin cupos'),
        h('p', { class: 'sub' }, 'Días en que no se agendará con un médico (o con ninguno), aunque normalmente tenga cupos: asuetos, vacaciones, congresos…'),
        edita ? h('form', { class: 'fila-form', onsubmit: async function (ev) {
          ev.preventDefault();
          if (!fecha.value) { tostada('Elija una fecha.', { error: true }); return; }
          try {
            const r = await api('sincupo.agregar', { fecha: fecha.value, medico: medico.value, motivo: motivo.value });
            const f = fecha.value;
            aplicarRespuesta(r, r.citas_afectadas ? null : 'Fecha sin cupos agregada.');
            if (r.citas_afectadas) {
              tostada('Atención: el ' + fechaSinAnio(f) + ' ya tenía ' + plural(r.citas_afectadas, 'cita', 'citas') + '. Reprográmelas.',
                { accion: { texto: 'Ver ese día', fn: function () { location.hash = '#/agenda/' + f; } } });
            }
          } catch (e) { tostada(e.message, { error: true }); }
        } },
          h('div', { class: 'campo' }, h('label', { for: 'sc-fecha' }, 'Fecha'), fecha),
          h('div', { class: 'campo' }, h('label', { for: 'sc-medico' }, 'Médico'), medico),
          h('div', { class: 'campo', style: 'flex:2 1 220px' }, h('label', { for: 'sc-motivo' }, 'Motivo (opcional)'), motivo),
          h('button', { class: 'btn oscuro', type: 'submit' }, 'Quitar cupos ese día')) : null,
        futuras.length ? h('ul', { class: 'lista-simple', style: 'margin-top:10px' }, futuras.map(function (x) {
          return h('li', null, h('span', { class: 'crece' }, h('b', null, fechaLarga(x.fecha)), ' — ' + (x.medico === 'TODOS' ? 'Todos los médicos' : x.medico) + (x.motivo ? ' · ' + x.motivo : '')),
            edita ? h('button', { class: 'btn chico peligro', onclick: async function () {
              try { aplicarRespuesta(await api('sincupo.eliminar', { fecha: x.fecha, medico: x.medico }), 'Cupos restablecidos ese día.'); } catch (e) { tostada(e.message, { error: true }); }
            } }, 'Quitar') : null);
        })) : h('p', { style: 'color:#51606f;margin:10px 0 0' }, 'No hay fechas sin cupos programadas.'))
    ]);
  }

  /* ============================== estadísticas ============================== */
  function contar(filas, fn, orden) {
    const m = {};
    filas.forEach(function (f) { const k = fn(f) || 'Sin dato'; m[k] = (m[k] || 0) + 1; });
    let pares = Object.keys(m).map(function (k) { return [k, m[k]]; });
    if (orden) pares = orden.map(function (k) { return [k, m[k] || 0]; }).concat(pares.filter(function (p) { return orden.indexOf(p[0]) < 0; }).sort(function (a, b) { return b[1] - a[1]; }));
    else pares.sort(function (a, b) { return b[1] - a[1]; });
    return pares;
  }
  function grupoEdad(f) {
    if (f.edad === '') return 'Sin dato';
    const n = Number(f.edad);
    const g = GRUPOS_EDAD.filter(function (x) { return n >= x[1] && n <= x[2]; })[0];
    return g ? g[0] : 'Sin dato';
  }
  function barras(pares, nombres) {
    const total = pares.reduce(function (s, p) { return s + p[1]; }, 0);
    const max = Math.max.apply(null, pares.map(function (p) { return p[1]; }).concat([1]));
    if (!total) return h('p', { style: 'color:#51606f;margin:0' }, 'Sin datos en este mes.');
    return h('div', { class: 'barras' }, pares.map(function (p) {
      const et = nombres ? nombres(p[0]) : p[0];
      return h('div', { class: 'barra-f' }, h('span', { class: 'et', title: p[0] }, et),
        h('span', { class: 'pista' }, p[1] ? h('span', { class: 'relleno', style: 'display:block;width:' + (p[1] / max * 100).toFixed(1) + '%' }) : null),
        h('span', { class: 'val' }, p[1], h('small', null, Math.round(p[1] / total * 100) + '%')));
    }));
  }
  /** Cupos programados de un médico en un mes (agenda semanal menos fechas sin cupos). */
  function cuposDelMes(mes, medico) {
    const p = mes.split('-').map(Number);
    const n = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    let total = 0;
    for (let d = 1; d <= n; d++) total += cuposDia(mes + '-' + String(d).padStart(2, '0'), medico).cupos;
    return total;
  }
  function vistaEstadisticas(main) {
    const u = ui('stats', { mes: (S.hoy || new Date().toISOString().slice(0, 10)).slice(0, 7) });
    const cab = h('div', { class: 'cab' }, h('h2', null, 'Estadísticas de ' + MESES[Number(u.mes.slice(5)) - 1] + ' de ' + u.mes.slice(0, 4)),
      h('div', { class: 'campo no-imprimir', style: 'margin:0;flex:0 0 170px' }, h('label', { for: 'mes' }, 'Mes'),
        h('input', { type: 'month', id: 'mes', value: u.mes, onchange: function (ev) { if (ev.target.value) { u.mes = ev.target.value; S.stats = null; pintar(); } } })),
      h('button', { class: 'btn no-imprimir', onclick: function () { window.print(); } }, 'Imprimir'));
    main.appendChild(cab);
    if (!S.stats || S.stats.mes !== u.mes) {
      main.appendChild(h('div', { class: 'vacio' }, 'Calculando…'));
      api('estadisticas', { mes: u.mes }).then(function (r) {
        S.stats = { mes: r.mes, filas: r.filas.map(function (arr) { const o = {}; r.columnas.forEach(function (c, i) { o[c] = arr[i]; }); return o; }) };
        if (ruta()[0] === 'estadisticas') pintar();
      }).catch(function (e) { if (ruta()[0] === 'estadisticas') { main.lastChild.textContent = e.message; } });
      return;
    }
    const mes = u.mes;
    const filas = S.stats.filas;
    const recibidas = filas.filter(function (f) { return f.fecha.slice(0, 7) === mes; });
    const realizados = filas.filter(function (f) { return f.estado === 'REALIZADO' && f.fecha_cierre.slice(0, 7) === mes; });
    const noReal = filas.filter(function (f) { return f.estado === 'NO REALIZADO' && f.fecha_cierre.slice(0, 7) === mes; });
    const pendientes = recibidas.filter(function (f) { return f.estado === 'PENDIENTE'; });
    const citasMes = filas.filter(function (f) { return f.cita_fecha.slice(0, 7) === mes; });
    const citasCumplidas = citasMes.filter(function (f) { return f.cita_fecha <= S.hoy && (f.estado === 'REALIZADO' || f.motivo_no === NO_ACUDIO); });
    const noAcudio = citasCumplidas.filter(function (f) { return f.motivo_no === NO_ACUDIO; });
    const avisaron = citasMes.filter(function (f) { return f.motivo_no === NO_ACUDIRA; });
    const conEspera = citasMes.filter(function (f) { return f.cita_fecha && f.fecha; });
    const espera = function (lista) {
      if (!lista.length) return null;
      const d = lista.map(function (f) { return Math.max(0, diasEntre(f.fecha, f.cita_fecha)); }).sort(function (a, b) { return a - b; });
      return { n: d.length, prom: d.reduce(function (s, x) { return s + x; }, 0) / d.length, mediana: d[Math.floor((d.length - 1) / 2)], max: d[d.length - 1] };
    };
    const eTodas = espera(conEspera);
    const kpi = function (clase, v, t) { return h('div', { class: 'kpi ' + clase }, h('div', { class: 'v' }, v), h('div', { class: 't' }, t)); };
    // Ocupación de cupos por médico: citas que ocupan cupo vs. cupos programados del mes.
    const nombres = S.medicos.map(function (m) { return m.nombre; });
    citasMes.forEach(function (f) { if (f.cita_medico && nombres.indexOf(f.cita_medico) < 0) nombres.push(f.cita_medico); });
    const ocup = nombres.map(function (m) {
      const suyas = citasMes.filter(function (f) { return f.cita_medico === m && (f.estado === 'PENDIENTE' || f.estado === 'REALIZADO' || f.motivo_no === NO_ACUDIO); });
      return { m: m, cupos: cuposDelMes(mes, m), normales: suyas.filter(function (f) { return !f.tipo_cupo; }).length,
        sobre: suyas.filter(function (f) { return f.tipo_cupo === TIPO_SOBRECUPO; }).length, extra: suyas.filter(function (f) { return f.tipo_cupo === TIPO_EXTRA; }).length,
        real: realizados.filter(function (f) { return f.realizado_por === m; }).length };
    }).filter(function (x) { return x.cupos || x.normales || x.sobre || x.extra || x.real; });
    const suma = function (k) { return ocup.reduce(function (s, x) { return s + x[k]; }, 0); };
    const pct = function (a, b) { return b ? Math.round(a / b * 100) + '%' : '–'; };
    const tablaOcup = h('table', { class: 'cruce' },
      h('thead', null, h('tr', null, ['Médico', 'Cupos del mes', 'Citas en cupo', 'Sobrecupos', 'Extracurriculares', '% ocupación', 'Realizados'].map(function (t) { return h('th', null, t); }))),
      h('tbody', null, ocup.map(function (x) {
        return h('tr', null, h('td', null, x.m), h('td', null, x.cupos), h('td', null, x.normales), h('td', null, x.sobre || '·'), h('td', null, x.extra || '·'),
          h('td', null, pct(x.normales + x.sobre, x.cupos)), h('td', null, x.real));
      })),
      h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', null, suma('cupos')), h('td', null, suma('normales')), h('td', null, suma('sobre')), h('td', null, suma('extra')),
        h('td', null, pct(suma('normales') + suma('sobre'), suma('cupos'))), h('td', null, suma('real')))));
    // Inasistencia por hospital
    const hosp = {};
    citasMes.forEach(function (f) {
      const x = hosp[f.hospital] = hosp[f.hospital] || { citas: 0, real: 0, no: 0, aviso: 0 };
      if (f.motivo_no === NO_ACUDIRA) x.aviso++;
      else if (f.cita_fecha <= S.hoy && (f.estado === 'REALIZADO' || f.motivo_no === NO_ACUDIO)) { x.citas++; if (f.motivo_no === NO_ACUDIO) x.no++; else x.real++; }
    });
    const filasHosp = Object.keys(hosp).filter(function (k) { return hosp[k].citas || hosp[k].aviso; }).sort(function (a, b) { return hosp[b].no - hosp[a].no || hosp[b].citas - hosp[a].citas; });
    const tablaInasistencia = h('table', { class: 'cruce' },
      h('thead', null, h('tr', null, h('th', null, 'Hospital'), h('th', null, 'Citas'), h('th', null, 'Realizados'), h('th', null, 'No acudió'), h('th', null, '% inasistencia'), h('th', null, 'Avisó que no vendría'))),
      h('tbody', null, filasHosp.map(function (k) {
        const x = hosp[k], p = x.citas ? Math.round(x.no / x.citas * 100) : 0;
        return h('tr', null, h('td', null, hospCorto(k)), h('td', null, x.citas), h('td', null, x.real), h('td', null, x.no || '·'), h('td', { class: p >= 25 ? 'rojo' : '' }, x.citas ? p + '%' : '–'), h('td', null, x.aviso || '·'));
      })),
      h('tfoot', null, h('tr', null, h('td', null, 'Total'), h('td', null, citasCumplidas.length), h('td', null, citasCumplidas.length - noAcudio.length), h('td', null, noAcudio.length),
        h('td', null, citasCumplidas.length ? Math.round(noAcudio.length / citasCumplidas.length * 100) + '%' : '–'), h('td', null, avisaron.length))));
    const tablaEspera = h('table', { class: 'cruce' },
      h('thead', null, h('tr', null, h('th', null, 'Origen'), h('th', null, 'Citas'), h('th', null, 'Promedio'), h('th', null, 'Mediana'), h('th', null, 'Máximo'))),
      h('tbody', null, [['FORMULARIO', 'Formulario'], ['MANUAL', 'Registro manual'], ['', 'Todas']].map(function (o) {
        const e = espera(conEspera.filter(function (f) { return !o[0] || f.origen === o[0]; }));
        return h('tr', null, h('td', null, o[1]), h('td', null, e ? e.n : 0), h('td', null, e ? e.prom.toFixed(1) + ' d' : '–'), h('td', null, e ? e.mediana + ' d' : '–'), h('td', null, e ? e.max + ' d' : '–'));
      })));
    const panel = function (titulo, contenido, clase, sub) { return h('section', { class: 'panel ' + (clase || '') }, h('h3', null, titulo), sub ? h('p', { class: 'sub' }, sub) : null, contenido); };
    const R = 'Estudios realizados';
    agregar(main, [
      h('div', { class: 'kpis' }, kpi('a', realizados.length, 'Ecocardiogramas realizados'), kpi('b', recibidas.length, 'Solicitudes recibidas'),
        kpi('c', noAcudio.length, 'Pacientes que no acudieron'), kpi('d', pendientes.length, 'Recibidas en el mes y aún pendientes'),
        kpi('b', eTodas ? eTodas.prom.toFixed(1) + ' d' : '–', 'Espera promedio de solicitud a cita')),
      h('div', { class: 'graficas' },
        ocup.length ? panel('Cupos y citas por médico', h('div', { class: 'tabla-scroll' }, tablaOcup), 'todo',
          'Citas del mes (pendientes, realizadas o no acudió) frente a los cupos programados. % ocupación = (citas en cupo + sobrecupos) / cupos. Los extracurriculares no cuentan contra los cupos.') : null,
        panel('Estudios realizados por médico', barras(contar(realizados, function (f) { return f.realizado_por; }))),
        panel('Por grupo de edad', barras(contar(realizados, grupoEdad, GRUPOS_EDAD.map(function (g) { return g[0]; }))), '', R),
        panel('Por sexo', barras(contar(realizados, function (f) { return f.sexo; }, SEXOS)), '', R),
        panel('Por hospital que refiere', barras(contar(realizados, function (f) { return f.hospital; }), hospCorto), '', R),
        panel('Solicitudes cerradas sin realizar', barras(contar(noReal, function (f) { return f.motivo_no; }, S.motivos.filter(function (m) { return noReal.some(function (f) { return f.motivo_no === m; }); }))), '', 'Por motivo'),
        panel('Solicitudes recibidas por hospital', barras(contar(recibidas, function (f) { return f.hospital; }), hospCorto), '', 'Todas las recibidas en el mes, se hayan realizado o no'),
        panel('Solicitudes recibidas por origen', barras(contar(recibidas, function (f) { return ORIGENES[f.origen] || f.origen; }, [ORIGENES.FORMULARIO, ORIGENES.MANUAL])), '', 'Formulario de Trabajo Social o registro manual'),
        filasHosp.length ? panel('Inasistencia por hospital', h('div', { class: 'tabla-scroll' }, tablaInasistencia), 'todo',
          'Citas del mes que ya ocurrieron y tienen resultado. "Avisó que no vendría" son las canceladas con tiempo (liberaron el cupo).') : null,
        conEspera.length ? panel('Días de espera de solicitud a cita', h('div', { class: 'tabla-scroll' }, tablaEspera), '', 'Citas del mes.') : null),
      h('p', { style: 'color:#51606f;font-size:13px' }, 'Los estudios realizados se cuentan en el mes en que se marcaron como realizados; las solicitudes recibidas, en el mes en que llegaron; las citas, en el mes de la cita.')
    ]);
  }

  /* ============================== usuarios y médicos ============================== */
  function vistaAdmin(main) {
    if (!S.usuarios) {
      main.appendChild(h('div', { class: 'vacio' }, 'Cargando…'));
      api('usuarios.listar').then(function (r) { S.usuarios = r.usuarios; if (ruta()[0] === 'admin') pintar(); })
        .catch(function (e) { if (ruta()[0] === 'admin') { main.textContent = ''; main.appendChild(h('div', { class: 'aviso error' }, e.message)); } });
      return;
    }
    const guardarMedicos = async function (lista, mensaje) {
      try { const r = await api('medicos.guardar', { medicos: lista }); S.medicos = r.medicos; S.config = r.config; S.cupos = null; pintar(); tostada(mensaje); } catch (e) { tostada(e.message, { error: true }); }
    };
    // Lo escrito se guarda en S.ui para que no se pierda si la pantalla se repinta (p. ej. al terminar de cargar el censo de reportes).
    const fu = ui('nuevoUsuario', { usuario: '', nombre: '', rol: 'ts', medico: '', clave: '', medicoNuevo: '' });
    const nuevoMedico = h('input', { type: 'text', id: 'nm', maxlength: 60, placeholder: 'Ej. Dra. Apellido', value: fu.medicoNuevo, oninput: function (ev) { fu.medicoNuevo = ev.target.value; } });
    const actualizar = async function (cambio, mensaje) {
      try { const r = await api('usuarios.actualizar', cambio); S.usuarios = r.usuarios; recalcularNombres(); pintar(); tostada(mensaje); } catch (e) { tostada(e.message, { error: true }); pintar(); }
    };
    const opRoles = [['ts', 'Trabajo Social'], ['medico', 'Médico'], ['admin', 'Administrador']];
    const opMedicos = [['', 'Elija el médico…']].concat(S.medicos.map(function (m) { return [m.nombre, m.nombre]; }));
    const campoTexto = function (id, k, ph, extra) {
      return h('input', Object.assign({ type: 'text', id: id, autocomplete: 'off', placeholder: ph, value: fu[k], oninput: function (ev) { fu[k] = ev.target.value; } }, extra || {}));
    };
    const nu = { usuario: campoTexto('nu-u', 'usuario', 'ej. lsocial', { autocapitalize: 'none' }), nombre: campoTexto('nu-n', 'nombre', 'Nombre completo'),
      clave: campoTexto('nu-c', 'clave', 'Mínimo 8 caracteres') };
    const cajaMed = h('div', { class: 'campo', hidden: fu.rol !== 'medico' }, h('label', { for: 'nu-m' }, 'Médico (su agenda)'));
    nu.medico = selector(opMedicos, fu.medico, { id: 'nu-m', onchange: function (ev) { fu.medico = ev.target.value; } });
    cajaMed.appendChild(nu.medico);
    nu.rol = selector(opRoles, fu.rol, { id: 'nu-r', onchange: function (ev) { fu.rol = ev.target.value; cajaMed.hidden = ev.target.value !== 'medico'; } });
    const errU = cajaError();
    agregar(main, [
      h('section', { class: 'panel' }, h('h3', null, 'Médicos que realizan ecocardiogramas'),
        h('p', { class: 'sub' }, 'Esta lista aparece al asignar citas, en el control de cupos y al marcar quién realizó cada estudio. Si un médico ya no está, desactívelo: sus estudios anteriores se conservan y deja de recibir citas.'),
        h('ul', { class: 'lista-simple' }, S.medicos.map(function (m, i) {
          return h('li', null, h('span', { class: 'crece' }, h('b', null, m.nombre), m.activo ? '' : ' (inactivo)'),
            h('button', { class: 'btn chico', onclick: function () {
              guardarMedicos(S.medicos.map(function (x, j) { return { nombre: x.nombre, activo: j === i ? !x.activo : x.activo }; }), m.activo ? 'Médico desactivado.' : 'Médico activado.');
            } }, m.activo ? 'Desactivar' : 'Activar'));
        })),
        h('form', { class: 'fila-form', style: 'margin-top:10px', onsubmit: function (ev) {
          ev.preventDefault();
          if (nuevoMedico.value.trim().length < 3) { tostada('Escriba el nombre del médico.', { error: true }); return; }
          fu.medicoNuevo = '';
          guardarMedicos(S.medicos.concat([{ nombre: nuevoMedico.value, activo: true }]), 'Médico agregado. Asígnele cupos en "Control de cupos".');
        } }, h('div', { class: 'campo' }, h('label', { for: 'nm' }, 'Agregar médico'), nuevoMedico), h('button', { class: 'btn oscuro', type: 'submit' }, 'Agregar'))),
      h('section', { class: 'panel' }, h('h3', null, 'Usuarios de la app de gestión'),
        h('p', { class: 'sub' }, 'Cada persona debe tener su propio usuario. Administrador: todo. Trabajo Social: todo menos esta sección. Médico: su agenda, censo, estadísticas y consulta de cupos; marca solo sus propias citas. A cada médico se le vincula su nombre de la lista para que vea solo su agenda.'),
        h('ul', { class: 'lista-simple' }, S.usuarios.map(function (x) {
          const propio = x.usuario === S.usuario.usuario;
          return h('li', null, h('span', { class: 'crece' }, h('b', null, x.nombre), ' · ' + x.usuario + (x.activo ? '' : ' (inactivo)') + (x.debe_cambiar ? ' · clave temporal' : '')),
            selector(opRoles, x.rol, { style: 'width:auto', disabled: propio, 'aria-label': 'Rol de ' + x.usuario,
              onchange: function (ev) {
                if (ev.target.value === 'medico' && !x.medico) { x.rol = 'medico'; pintar(); tostada('Elija también el médico al que corresponde este usuario.'); return; }
                actualizar({ usuario: x.usuario, rol: ev.target.value }, 'Rol actualizado.');
              } }),
            x.rol === 'medico' ? selector(opMedicos, x.medico, { style: 'width:auto', 'aria-label': 'Médico de ' + x.usuario,
              onchange: function (ev) { actualizar({ usuario: x.usuario, rol: 'medico', medico: ev.target.value }, 'Médico vinculado.'); } }) : null,
            h('button', { class: 'btn chico', onclick: function () { restablecer(x); } }, 'Nueva contraseña'),
            propio ? null : h('button', { class: 'btn chico' + (x.activo ? ' peligro' : ''), onclick: function () { actualizar({ usuario: x.usuario, activo: !x.activo }, x.activo ? 'Usuario desactivado.' : 'Usuario activado.'); } }, x.activo ? 'Desactivar' : 'Activar'));
        })),
        h('h3', { style: 'margin-top:18px' }, 'Crear usuario'),
        h('form', { class: 'fila-form', onsubmit: async function (ev) {
          ev.preventDefault();
          errU.textContent = '';
          try {
            const r = await api('usuarios.crear', { usuario: nu.usuario.value, nombre: nu.nombre.value, rol: nu.rol.value, medico: nu.medico.value, clave: nu.clave.value });
            S.usuarios = r.usuarios;
            recalcularNombres();
            Object.assign(fu, { usuario: '', nombre: '', rol: 'ts', medico: '', clave: '' });
            pintar();
            tostada('Usuario creado. Entréguele su contraseña temporal en persona.');
          } catch (e) { mostrarError(errU, e); }
        } },
          h('div', { class: 'campo' }, h('label', { for: 'nu-u' }, 'Usuario'), nu.usuario),
          h('div', { class: 'campo' }, h('label', { for: 'nu-n' }, 'Nombre'), nu.nombre),
          h('div', { class: 'campo' }, h('label', { for: 'nu-r' }, 'Rol'), nu.rol),
          cajaMed,
          h('div', { class: 'campo' }, h('label', { for: 'nu-c' }, 'Contraseña temporal'), nu.clave),
          h('button', { class: 'btn oscuro', type: 'submit' }, 'Crear usuario')),
        errU),
      panelPlantillas(),
      panelReportes()
    ]);
  }
  /* ---------- plantillas de comentario ---------- */
  function panelPlantillas() {
    const guardar = async function (lista, mensaje) {
      const r = await api('plantillas.guardar', { plantillas: lista });
      S.plantillas = r.plantillas;
      pintar();
      tostada(mensaje);
    };
    const editar = function (i) {
      const p = i >= 0 ? S.plantillas[i] : { nombre: '', texto: '' };
      modalChico(i >= 0 ? 'Editar plantilla' : 'Nueva plantilla', function (cerrar) {
        const err = cajaError();
        const nombre = h('input', { type: 'text', id: 'pl-n', maxlength: '60', value: p.nombre, 'data-foco': true, placeholder: 'Ej. Paciente reprogramado por TS' });
        const texto = h('textarea', { id: 'pl-t', rows: '9', maxlength: '5000' });
        texto.value = p.texto;
        const btn = h('button', { class: 'btn primario ancho', type: 'submit' }, 'Guardar plantilla');
        return h('form', { onsubmit: async function (ev) {
          ev.preventDefault();
          const lista = S.plantillas.slice();
          const nueva = { nombre: nombre.value, texto: texto.value };
          if (i >= 0) lista[i] = nueva; else lista.push(nueva);
          try { await conBoton(btn, function () { return guardar(lista, i >= 0 ? 'Plantilla actualizada.' : 'Plantilla agregada.'); }); cerrar(); } catch (e) { mostrarError(err, e); }
        } },
        h('div', { class: 'campo' }, h('label', { for: 'pl-n' }, 'Nombre'), nombre),
        h('div', { class: 'campo' }, h('label', { for: 'pl-t' }, 'Texto'), texto), err, btn);
      });
    };
    return h('section', { class: 'panel' }, h('h3', null, 'Plantillas de comentario'),
      h('p', { class: 'sub' }, 'Textos prehechos que se pueden insertar en el comentario de cada solicitud.'),
      S.plantillas.length ? h('ul', { class: 'lista-simple' }, S.plantillas.map(function (p, i) {
        return h('li', null, h('span', { class: 'crece' }, h('b', null, p.nombre), h('div', { class: 'tenue recorte' }, p.texto)),
          h('button', { class: 'btn chico', onclick: function () { editar(i); } }, 'Editar'),
          h('button', { class: 'btn chico peligro', onclick: async function () {
            if (!(await preguntar('¿Eliminar la plantilla?', '"' + p.nombre + '" dejará de aparecer. Los comentarios ya guardados no cambian.', 'Sí, eliminar', 'Cancelar', 'peligro'))) return;
            try { await guardar(S.plantillas.filter(function (x, j) { return j !== i; }), 'Plantilla eliminada.'); } catch (e) { tostada(e.message, { error: true }); }
          } }, 'Eliminar'));
      })) : h('p', { class: 'tenue', style: 'margin:0' }, 'Aún no hay plantillas.'),
      h('button', { class: 'btn oscuro', style: 'margin-top:12px', onclick: function () { editar(-1); } }, 'Nueva plantilla'));
  }

  /** Espacio usado en la cuenta de Google del sistema. */
  function espacioDrive(x) {
    if (!x || !(x.limite > 0)) return null;
    const gb = function (n) { return (n / 1073741824).toFixed(1).replace('.', ',') + ' GB'; };
    const pct = Math.round(100 * x.usado / x.limite);
    return h('div', { class: pct >= 80 ? 'aviso alerta' : 'tenue', style: 'margin-top:10px' },
      'Espacio de Google usado por la cuenta del sistema: ' + gb(x.usado) + ' de ' + gb(x.limite) + ' (' + pct + ' %).',
      h('div', { class: 'progreso-barra', style: 'margin-top:6px;max-width:420px' }, h('span', { style: 'width:' + Math.min(100, pct) + '%' })));
  }

  /* ---------- censo automático de reportes ---------- */
  function panelReportes() {
    const titulo = h('h3', null, 'Censo automático de reportes de ecocardiograma');
    const e = S.estadoReportes;
    if (!e || e.cargando) {
      if (!e) {
        S.estadoReportes = { cargando: true };
        api('reportes.estado').then(function (r) { S.estadoReportes = r; }).catch(function (x) { S.estadoReportes = { error: x.message }; })
          .then(function () { if (ruta()[0] === 'admin' && !modalesAbiertos()) pintar(); });
      }
      return h('section', { class: 'panel' }, titulo, h('div', { class: 'vacio' }, 'Cargando…'));
    }
    if (e.error && !('activo' in e)) return h('section', { class: 'panel' }, titulo, h('div', { class: 'aviso error' }, e.error));
    const ejecutar = async function (btn, completo) {
      if (completo && !(await preguntar('¿Revisar toda la carpeta?', 'Se revisan todos los PDF de la carpeta del ecógrafo, no solo los nuevos. Los que ya están en el censo no se duplican. Puede tardar unos minutos.', 'Sí, revisar todo', 'Cancelar'))) return;
      try {
        const r = await conBoton(btn, function () { return api('reportes.ejecutar', { completo: !!completo }); });
        S.estadoReportes = r;
        const x = r.resultado;
        tostada(plural(x.nuevos, 'reporte nuevo', 'reportes nuevos') + ' en el censo · ' + plural(x.automaticos, 'vinculado', 'vinculados') + ' · ' + x.revisar + ' por revisar' + (x.error ? ' · ' + x.error : ''), { error: !!x.error });
        await sincronizar(true);
      } catch (err) { tostada(err.message, { error: true }); }
      pintar();
    };
    return h('section', { class: 'panel' }, titulo,
      h('p', { class: 'sub' }, 'Cada hora, de ' + e.horario + ', se censa la carpeta de Drive del ecógrafo (la misma de las otras plataformas). Quince minutos después se vinculan los reportes con las solicitudes que no los tienen: si coinciden expediente, nombre y fecha de nacimiento se vinculan solos; con dos datos (siempre el nombre) quedan "por revisar". El sistema solo lee esa carpeta.'),
      !e.drive_api ? h('div', { class: 'aviso error' }, 'Falta activar el servicio "Drive API" en el editor de Apps Script. Vea la guía de instalación.') : null,
      e.drive_api && !e.activo ? h('div', { class: 'aviso alerta' }, 'La revisión automática no está activada. En el editor de Apps Script ejecute una vez la función "activarReportes" (guía de instalación).') : null,
      e.error ? h('div', { class: 'aviso error' }, 'Último error: ' + e.error) : null,
      h('dl', { class: 'datos' }, dato('Revisión automática', e.activo ? 'Activa' : 'Inactiva'), dato('Solicitudes desde', fechaCorta(e.desde)),
        dato('Reportes en el censo', String(e.censados)), dato('Vinculados', String(e.vinculados)), dato('Por revisar', String(e.por_revisar)),
        dato('Último censo', e.ultimo_censo), dato('Última vinculación', e.ultima_vinculacion),
        h('div', null, h('dt', null, 'Carpeta'), h('dd', null, h('a', { href: 'https://drive.google.com/drive/folders/' + e.carpeta, target: '_blank', rel: 'noopener' }, 'Abrir en Drive')))),
      espacioDrive(e.espacio),
      h('div', { class: 'acciones-rep', style: 'margin-top:14px' },
        h('button', { class: 'btn oscuro', disabled: !e.drive_api, onclick: function (ev) { ejecutar(ev.currentTarget, false); } }, 'Censar y vincular ahora'),
        h('button', { class: 'btn', disabled: !e.drive_api, onclick: function (ev) { ejecutar(ev.currentTarget, true); } }, 'Revisar toda la carpeta')));
  }
  function restablecer(x) {
    modalChico('Nueva contraseña para ' + x.usuario, function (cerrar) {
      const err = cajaError();
      const clave = h('input', { type: 'text', id: 'rs-c', autocomplete: 'off', 'data-foco': true });
      return h('form', { onsubmit: async function (ev) {
        ev.preventDefault();
        try { const r = await api('usuarios.restablecer', { usuario: x.usuario, clave: clave.value }); S.usuarios = r.usuarios; cerrar(); pintar(); tostada('Contraseña temporal asignada.'); } catch (e) { mostrarError(err, e); }
      } }, h('p', { style: 'margin-top:0' }, 'Se le pedirá cambiarla la próxima vez que ingrese.'),
        h('div', { class: 'campo' }, h('label', { for: 'rs-c' }, 'Contraseña temporal (mínimo 8 caracteres)'), clave), err,
        h('button', { class: 'btn primario ancho', type: 'submit' }, 'Asignar'));
    });
  }

  /* ============================== arranque ============================== */
  window.addEventListener('hashchange', function () {
    if (ruta()[0] !== 'cupos') S.cupos = null;
    if (ruta()[0] !== 'admin') S.usuarios = S.estadoReportes = null;
    S.panel = null;
    window.scrollTo(0, 0);
    pintar();
    window.scrollTo(0, 0);
  });
  window.addEventListener('beforeunload', function (ev) { if (S.registro && S.registro.sucio && !S.registro.resultado) { ev.preventDefault(); ev.returnValue = ''; } });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.token && S.sincronizado) sincronizar(true); });
  setInterval(function () { if (!document.hidden && S.token && S.sincronizado && !modalesAbiertos() && ruta()[0] !== 'registro') sincronizar(true); }, 120000);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* sin modo offline */ }); });
  }

  S.token = leerToken();
  if (S.token) { $app.textContent = ''; $app.appendChild(h('p', { class: 'cargando-inicial' }, 'Cargando…')); iniciar(); } else pintarAcceso();
})();
