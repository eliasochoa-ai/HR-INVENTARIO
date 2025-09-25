import React, { useMemo, useState, useEffect } from "react";

// Utils
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);
const LS_KEY = "mini_erp_inventario_store_v1";

function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error cargando localStorage", e);
    return null;
  }
}
function saveStore(store) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); }
  catch (e) { console.error("Error guardando localStorage", e); }
}

function toCSV(rows, headers) {
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v).replaceAll("\n", " ");
    if (/[\\\",;\\n]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
    return s;
  };
  const head = headers.map((h) => esc(h.label)).join(";");
  const body = rows.map((r) => headers.map((h) => esc(h.get(r))).join(";")).join("\n");
  return head + "\n" + body;
}
function download(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ======= 1) Validación de stock ======= */
function saldoActual(store, clienteId, productoId) {
  return store.movimientos.reduce((acc, m) => {
    if (m.clienteId === clienteId && m.productoId === productoId) {
      return acc + (m.tipo === "ING" ? Number(m.cantidad) : -Number(m.cantidad));
    }
    return acc;
  }, 0);
}

/* ======= 2) Importar CSV ======= */
const norm = (s) => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function parseCSVLine(line, sep) {
  let out = [], cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
    } else if (ch === sep && !inQ) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
async function importarMovimientosDesdeCSV(file, store, setStore) {
  if (!file) return;
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) { alert("CSV vacío."); return; }

  const sep = lines[0].includes(";") ? ";" : ",";
  const headersRaw = parseCSVLine(lines[0], sep);
  const headers = headersRaw.map((h) => norm(h));

  const findIdx = (names) => headers.findIndex((h) => names.some((n) => h === norm(n) || h.startsWith(norm(n))));
  const ix = {
    fecha: findIdx(["fecha","date"]),
    tipo: findIdx(["tipo","type"]),
    cliente: findIdx(["cliente","client"]),
    producto: findIdx(["producto","product"]),
    cantidad: findIdx(["cantidad","qty","cantidad (und)"]),
    guiaRemitente: findIdx(["guia remitente","guía remitente"]),
    guiaTransportista: findIdx(["guia transportista","guía transportista"]),
    contenedor: findIdx(["contenedor","container"]),
    dua: findIdx(["dua"]),
    chofer: findIdx(["chofer","driver"]),
    tracto: findIdx(["tracto","plate","placa"]),
    obs: findIdx(["obs","observaciones","observacion","observación","notes"]),
    codigo: findIdx(["codigo","código","code"]),
    unidad: findIdx(["unidad","unit"]),
  };

  setStore((prev) => {
    const clientes = [...prev.clientes];
    const productos = [...prev.productos];
    const getClienteId = (nombre) => {
      if (!nombre) return "";
      const n = String(nombre).trim();
      let c = clientes.find(x => norm(x.nombre) === norm(n));
      if (!c) { c = { id: uid(), nombre: n, ruc: "" }; clientes.push(c); }
      return c.id;
    };
    const getProductoId = (nombre, codigo, unidad) => {
      const n = String(nombre || "").trim();
      const cod = String(codigo || "").trim();
      let p = productos.find(x => (cod && norm(x.codigo) === norm(cod)) || (n && norm(x.nombre) === norm(n)));
      if (!p) {
        p = { id: uid(), codigo: cod, nombre: n || cod || "Producto", unidad: unidad || "unidad" };
        productos.push(p);
      }
      return p.id;
    };

    const nuevos = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i], sep);
      const tipo = ((ix.tipo>=0? cols[ix.tipo] : "") || "").toUpperCase().includes("EGR") ? "EGR" : "ING";
      const fecha = ((ix.fecha>=0? cols[ix.fecha] : "") || todayISO()).slice(0, 10);
      const clienteNombre = ix.cliente>=0 ? cols[ix.cliente] : "";
      const productoNombre = ix.producto>=0 ? cols[ix.producto] : "";
      const codigo = ix.codigo>=0 ? cols[ix.codigo] : "";
      const unidad = ix.unidad>=0 ? cols[ix.unidad] : "";
      const cantidad = Number(ix.cantidad>=0 ? cols[ix.cantidad] : "0") || 0;

      const clienteId = getClienteId(clienteNombre);
      const productoId = getProductoId(productoNombre, codigo, unidad);

      if (tipo === "EGR") {
        const saldo = prev.movimientos.concat(nuevos).reduce((acc, m) => {
          if (m.clienteId === clienteId && m.productoId === productoId) {
            return acc + (m.tipo === "ING" ? Number(m.cantidad) : -Number(m.cantidad));
          }
          return acc;
        }, 0);
        if (cantidad > saldo) { console.warn("Fila", i + 1, "sin stock suficiente. Se omitió."); continue; }
      }

      nuevos.push({
        id: uid(), fecha, tipo, clienteId, productoId, cantidad,
        guiaRemitente: ix.guiaRemitente>=0 ? cols[ix.guiaRemitente] : "",
        guiaTransportista: ix.guiaTransportista>=0 ? cols[ix.guiaTransportista] : "",
        contenedor: ix.contenedor>=0 ? cols[ix.contenedor] : "",
        dua: ix.dua>=0 ? cols[ix.dua] : "",
        chofer: ix.chofer>=0 ? cols[ix.chofer] : "",
        tracto: ix.tracto>=0 ? cols[ix.tracto] : "",
        observaciones: ix.obs>=0 ? cols[ix.obs] : "",
      });
    }

    alert(`Importados ${nuevos.length} movimientos`);
    return { ...prev, clientes, productos, movimientos: [...nuevos, ...prev.movimientos] };
  });
}

/* ======= 3) Backup / Restore ======= */
function exportarJSON(store) {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_inventario_${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
async function importarJSON(file, setStore) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.movimientos)) throw new Error("Formato inválido");
    setStore(data);
    alert("Backup restaurado correctamente");
  } catch (e) {
    console.error(e);
    alert("No se pudo importar el backup");
  }
}

// UI atoms
const Chip = ({ children }) => (
  <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 border border-gray-200">{children}</span>
);
const Toolbar = ({ children }) => (
  <div className="flex flex-wrap gap-2 items-center justify-between mb-3">{children}</div>
);
const Card = ({ title, children, footer, className = "" }) => (
  <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${className}`}>
    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
      <h3 className="font-semibold text-gray-800">{title}</h3>
      {footer}
    </div>
    <div className="p-4">{children}</div>
  </div>
);
const Stat = ({ label, value, hint }) => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
    <div className="text-sm text-gray-500">{label}</div>
    <div className="text-2xl font-semibold text-gray-800">{value}</div>
    {hint && <div className="text-xs text-gray-400">{hint}</div>}
  </div>
);
const Input = ({ label, ...props }) => (
  <label className="block">
    <div className="text-xs text-gray-600 mb-1">{label}</div>
    <input className="w-full rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200 px-3 py-2" {...props} />
  </label>
);
const Select = ({ label, children, ...props }) => (
  <label className="block">
    <div className="text-xs text-gray-600 mb-1">{label}</div>
    <select className="w-full rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200 px-3 py-2 bg-white" {...props}>
      {children}
    </select>
  </label>
);
const TextArea = ({ label, ...props }) => (
  <label className="block">
    <div className="text-xs text-gray-600 mb-1">{label}</div>
    <textarea className="w-full rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200 px-3 py-2" {...props} />
  </label>
);
const Button = ({ children, className = "", ...props }) => (
  <button className={`rounded-xl px-3 py-2 border border-gray-300 bg-gray-50 hover:bg-gray-100 active:scale-[0.99] transition ${className}`} {...props}>
    {children}
  </button>
);
const TabButton = ({ active, children, ...props }) => (
  <button
    className={`px-3 py-2 rounded-xl border text-sm ${active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
    {...props}
  >
    {children}
  </button>
);

// App
export default function App() {
  const [tab, setTab] = useState("dashboard");

  const [store, setStore] = useState(() =>
    loadStore() || {
      clientes: [
        { id: uid(), nombre: "PROCOMSAC", ruc: "" },
        { id: uid(), nombre: "ATLANTICA", ruc: "" },
        { id: uid(), nombre: "EL ÁGUILA", ruc: "" },
      ],
      productos: [{ id: uid(), codigo: "SACO25", nombre: "Saco 25 kg", unidad: "saco" }],
      movimientos: [],
      empresa: { nombre: "HR & NE Inversiones EIRL", ruc: "", almacen: "Chancay" },
    }
  );
  useEffect(() => saveStore(store), [store]);

  const [movForm, setMovForm] = useState({
    fecha: todayISO(),
    tipo: "ING",
    clienteId: "",
    productoId: "",
    cantidad: "",
    guiaRemitente: "",
    guiaTransportista: "",
    contenedor: "",
    dua: "",
    chofer: "",
    tracto: "",
    observaciones: "",
  });
  const [prodForm, setProdForm] = useState({ codigo: "", nombre: "", unidad: "saco" });
  const [cliForm, setCliForm] = useState({ nombre: "", ruc: "" });

  const [filtros, setFiltros] = useState({
    clienteId: "",
    productoId: "",
    tipo: "",
    desde: "",
    hasta: "",
    contenedor: "",
    dua: "",
    guia: "",
  });

  const clientesById = useMemo(() => Object.fromEntries(store.clientes.map((c) => [c.id, c])), [store.clientes]);
  const productosById = useMemo(() => Object.fromEntries(store.productos.map((p) => [p.id, p])), [store.productos]);

  const movimientosFiltrados = useMemo(() => {
    return store.movimientos.filter((m) => {
      if (filtros.clienteId && m.clienteId !== filtros.clienteId) return false;
      if (filtros.productoId && m.productoId !== filtros.productoId) return false;
      if (filtros.tipo && m.tipo !== filtros.tipo) return false;
      if (filtros.contenedor && !m.contenedor.toLowerCase().includes(filtros.contenedor.toLowerCase())) return false;
      if (filtros.dua && !m.dua.toLowerCase().includes(filtros.dua.toLowerCase())) return false;
      if (filtros.guia && !(`${m.guiaRemitente} ${m.guiaTransportista}`.toLowerCase().includes(filtros.guia.toLowerCase()))) return false;
      if (filtros.desde && m.fecha < filtros.desde) return false;
      if (filtros.hasta && m.fecha > filtros.hasta) return false;
      return true;
    });
  }, [store.movimientos, filtros]);

  const saldos = useMemo(() => {
    const map = new Map();
    for (const m of store.movimientos) {
      const key = `${m.productoId}::${m.clienteId}`;
      const prev = map.get(key) || { ingreso: 0, egreso: 0 };
      if (m.tipo === "ING") prev.ingreso += Number(m.cantidad);
      else prev.egreso += Number(m.cantidad);
      map.set(key, prev);
    }
    const rows = [];
    for (const [key, v] of map.entries()) {
      const [productoId, clienteId] = key.split("::");
      const prod = productosById[productoId];
      const cli = clientesById[clienteId];
      rows.push({
        key,
        productoId,
        clienteId,
        producto: prod?.nombre || "—",
        codigo: prod?.codigo || "—",
        unidad: prod?.unidad || "—",
        cliente: cli?.nombre || "—",
        ingreso: v.ingreso,
        egreso: v.egreso,
        saldo: v.ingreso - v.egreso,
      });
    }
    rows.sort((a, b) => (a.cliente + a.producto).localeCompare(b.cliente + b.producto));
    return rows;
  }, [store.movimientos, productosById, clientesById]);

  const stats = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const first = new Date(y, m, 1).toISOString().slice(0, 10);
    const last = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    let ingresosMes = 0, egresosMes = 0, viajesMes = 0;
    for (const mov of store.movimientos) {
      if (mov.fecha >= first && mov.fecha <= last) {
        viajesMes += 1;
        if (mov.tipo === "ING") ingresosMes += Number(mov.cantidad);
        else egresosMes += Number(mov.cantidad);
      }
    }
    const stockTotal = saldos.reduce((acc, r) => acc + r.saldo, 0);
    return { ingresosMes, egresosMes, viajesMes, stockTotal };
  }, [store.movimientos, saldos]);

  /* ======= Acciones ======= */
  function agregarMovimiento() {
    if (!movForm.clienteId || !movForm.productoId || !movForm.cantidad) {
      alert("Completa cliente, producto y cantidad");
      return;
    }
    const qty = Number(movForm.cantidad);
    if (qty <= 0) { alert("La cantidad debe ser mayor a 0"); return; }

    if (movForm.tipo === "EGR") {
      const saldo = saldoActual(store, movForm.clienteId, movForm.productoId);
      if (qty > saldo) {
        alert(`No hay stock suficiente. Saldo actual: ${saldo}`);
        return;
      }
    }

    const nuevo = { id: uid(), ...movForm, cantidad: qty };
    setStore((s) => ({ ...s, movimientos: [nuevo, ...s.movimientos] }));
    setMovForm({
      fecha: todayISO(),
      tipo: movForm.tipo,
      clienteId: movForm.clienteId,
      productoId: movForm.productoId,
      cantidad: "",
      guiaRemitente: "",
      guiaTransportista: "",
      contenedor: "",
      dua: "",
      chofer: "",
      tracto: "",
      observaciones: "",
    });
    setTab("movimientos");
  }
  function eliminarMovimiento(id) {
    if (!confirm("¿Eliminar movimiento?")) return;
    setStore((s) => ({ ...s, movimientos: s.movimientos.filter((m) => m.id !== id) }));
  }
  function agregarProducto() {
    if (!prodForm.nombre) return alert("Nombre requerido");
    const p = { id: uid(), codigo: prodForm.codigo || "", nombre: prodForm.nombre, unidad: prodForm.unidad || "unidad" };
    setStore((s) => ({ ...s, productos: [p, ...s.productos] }));
    setProdForm({ codigo: "", nombre: "", unidad: "saco" });
  }
  function agregarCliente() {
    if (!cliForm.nombre) return alert("Nombre requerido");
    const c = { id: uid(), nombre: cliForm.nombre, ruc: cliForm.ruc || "" };
    setStore((s) => ({ ...s, clientes: [c, ...s.clientes] }));
    setCliForm({ nombre: "", ruc: "" });
  }
  function exportarMovimientos() {
    const headers = [
      { label: "Fecha", get: (r) => r.fecha },
      { label: "Tipo", get: (r) => r.tipo },
      { label: "Cliente", get: (r) => (clientesById[r.clienteId]?.nombre || "") },
      { label: "Producto", get: (r) => (productosById[r.productoId]?.nombre || "") },
      { label: "Cantidad", get: (r) => r.cantidad },
      { label: "Unidad", get: (r) => (productosById[r.productoId]?.unidad || "") },
      { label: "Guía Remitente", get: (r) => r.guiaRemitente },
      { label: "Guía Transportista", get: (r) => r.guiaTransportista },
      { label: "Contenedor", get: (r) => r.contenedor },
      { label: "DUA", get: (r) => r.dua },
      { label: "Chofer", get: (r) => r.chofer },
      { label: "Tracto", get: (r) => r.tracto },
      { label: "Obs", get: (r) => r.observaciones },
      { label: "_id", get: (r) => r.id },
    ];
    const csv = toCSV(movimientosFiltrados, headers);
    download(`movimientos_${todayISO()}.csv`, csv);
  }
  function exportarSaldos() {
    const headers = [
      { label: "Cliente", get: (r) => r.cliente },
      { label: "Código", get: (r) => r.codigo },
      { label: "Producto", get: (r) => r.producto },
      { label: "Unidad", get: (r) => r.unidad },
      { label: "Ingreso", get: (r) => r.ingreso },
      { label: "Egreso", get: (r) => r.egreso },
      { label: "Saldo", get: (r) => r.saldo },
    ];
    const csv = toCSV(saldos, headers);
    download(`saldos_${todayISO()}.csv`, csv);
  }
  function resetearDatos() {
    if (!confirm("Esto borrará toda la información. ¿Continuar?")) return;
    const base = { clientes: [], productos: [], movimientos: [], empresa: { nombre: "", ruc: "", almacen: "" } };
    setStore(base);
    saveStore(base);
  }

  const MovimientoForm = () => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      <Select label="Tipo" value={movForm.tipo} onChange={(e) => setMovForm({ ...movForm, tipo: e.target.value })}>
        <option value="ING">INGRESO</option>
        <option value="EGR">EGRESO</option>
      </Select>
      <Input label="Fecha" type="date" value={movForm.fecha} onChange={(e) => setMovForm({ ...movForm, fecha: e.target.value })} />
      <Select label="Cliente" value={movForm.clienteId} onChange={(e) => setMovForm({ ...movForm, clienteId: e.target.value })}>
        <option value="">— Seleccionar —</option>
        {store.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </Select>
      <Select label="Producto" value={movForm.productoId} onChange={(e) => setMovForm({ ...movForm, productoId: e.target.value })}>
        <option value="">— Seleccionar —</option>
        {store.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </Select>
      <Input label="Cantidad" type="number" min="0" value={movForm.cantidad} onChange={(e) => setMovForm({ ...movForm, cantidad: e.target.value })} />
      <Input label="Guía Remitente" value={movForm.guiaRemitente} onChange={(e) => setMovForm({ ...movForm, guiaRemitente: e.target.value })} />
      <Input label="Guía Transportista" value={movForm.guiaTransportista} onChange={(e) => setMovForm({ ...movForm, guiaTransportista: e.target.value })} />
      <Input label="Contenedor" value={movForm.contenedor} onChange={(e) => setMovForm({ ...movForm, contenedor: e.target.value })} />
      <Input label="DUA" value={movForm.dua} onChange={(e) => setMovForm({ ...movForm, dua: e.target.value })} />
      <Input label="Chofer" value={movForm.chofer} onChange={(e) => setMovForm({ ...movForm, chofer: e.target.value })} />
      <Input label="Tracto" value={movForm.tracto} onChange={(e) => setMovForm({ ...movForm, tracto: e.target.value })} />
      <TextArea label="Observaciones" value={movForm.observaciones} onChange={(e) => setMovForm({ ...movForm, observaciones: e.target.value })} />
      <div className="flex gap-2 items-end">
        <Button onClick={agregarMovimiento} className="bg-gray-900 text-white border-gray-900">Registrar movimiento</Button>
        <Button onClick={() => setMovForm({
          fecha: todayISO(), tipo: movForm.tipo, clienteId: "", productoId: "", cantidad: "", guiaRemitente: "", guiaTransportista: "", contenedor: "", dua: "", chofer: "", tracto: "", observaciones: "",
        })}>Limpiar</Button>
      </div>
    </div>
  );

  const Dashboard = () => (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      <Stat label="Stock total (todos los clientes)" value={stats.stockTotal} hint="Suma de saldos" />
      <Stat label="Ingresos mes" value={stats.ingresosMes} />
      <Stat label="Egresos mes" value={stats.egresosMes} />
      <Stat label="Movimientos del mes" value={stats.viajesMes} />
      <Card title="Nuevo movimiento" className="md:col-span-2" footer={<Chip>Ingreso/Egreso con guías, DUA y contenedor</Chip>}>
        <MovimientoForm />
      </Card>
      <Card title="Atajos" className="md:col-span-2">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setTab("movimientos")}>Ver Movimientos</Button>
          <Button onClick={() => setTab("inventario")}>Ver Inventario</Button>
          <Button onClick={() => setTab("productos")}>Productos</Button>
          <Button onClick={() => setTab("clientes")}>Clientes</Button>
          <Button onClick={() => setTab("reportes")}>Reportes</Button>
          <Button onClick={exportarSaldos}>Exportar saldos</Button>
          {/* Backup / Restore */}
          <Button onClick={() => exportarJSON(store)}>Backup JSON</Button>
          <label className="cursor-pointer">
            <input type="file" accept="application/json" className="hidden"
              onChange={(e) => importarJSON(e.target.files?.[0], setStore)} />
            <span className="rounded-xl px-3 py-2 border border-gray-300 bg-gray-50 hover:bg-gray-100">Restaurar JSON</span>
          </label>
          <Button className="ml-auto" onClick={resetearDatos}>⚠️ Resetear datos</Button>
        </div>
      </Card>
    </div>
  );

  const Movimientos = () => (
    <div className="flex flex-col gap-3">
      <Card title="Filtros" footer={
        <div className="flex gap-2 items-center">
          <Button onClick={exportarMovimientos}>Exportar CSV</Button>
          {/* Importar CSV */}
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => importarMovimientosDesdeCSV(e.target.files?.[0], store, setStore)}
            />
            <span className="rounded-xl px-3 py-2 border border-gray-300 bg-gray-50 hover:bg-gray-100">
              Importar CSV
            </span>
          </label>
        </div>
      }>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Select label="Cliente" value={filtros.clienteId} onChange={(e) => setFiltros({ ...filtros, clienteId: e.target.value })}>
            <option value="">Todos</option>
            {store.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
          <Select label="Producto" value={filtros.productoId} onChange={(e) => setFiltros({ ...filtros, productoId: e.target.value })}>
            <option value="">Todos</option>
            {store.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Select>
          <Select label="Tipo" value={filtros.tipo} onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}>
            <option value="">Todos</option>
            <option value="ING">INGRESO</option>
            <option value="EGR">EGRESO</option>
          </Select>
          <Input label="Desde" type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
          <Input label="Hasta" type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
          <Input label="Buscar por contenedor" value={filtros.contenedor} onChange={(e) => setFiltros({ ...filtros, contenedor: e.target.value })} />
          <Input label="Buscar por DUA" value={filtros.dua} onChange={(e) => setFiltros({ ...filtros, dua: e.target.value })} />
          <Input label="Buscar por Nº de guía" value={filtros.guia} onChange={(e) => setFiltros({ ...filtros, guia: e.target.value })} />
          <div className="md:col-span-6 flex justify-end">
            <Button onClick={() => setFiltros({ clienteId: "", productoId: "", tipo: "", desde: "", hasta: "", contenedor: "", dua: "", guia: "" })}>Limpiar filtros</Button>
          </div>
        </div>
      </Card>

      <Card title={`Movimientos (${movimientosFiltrados.length})`}>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left bg-gray-50">
                {["Fecha","Tipo","Cliente","Producto","Cant.","Und.","Guía Rem.","Guía Trans.","Contenedor","DUA","Chofer","Tracto","Obs",""].map((h) =>
                  <th key={h} className="px-2 py-2 border-b border-gray-100 whitespace-nowrap text-gray-600">{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {movimientosFiltrados.map((m) => (
                <tr key={m.id} className="odd:bg-white even:bg-gray-50">
                  <td className="px-2 py-2 border-b">{m.fecha}</td>
                  <td className="px-2 py-2 border-b">{m.tipo === "ING" ? <Chip>ING</Chip> : <Chip>EGR</Chip>}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{clientesById[m.clienteId]?.nombre || "—"}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{productosById[m.productoId]?.nombre || "—"}</td>
                  <td className="px-2 py-2 border-b text-right">{m.cantidad}</td>
                  <td className="px-2 py-2 border-b">{productosById[m.productoId]?.unidad || ""}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{m.guiaRemitente}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{m.guiaTransportista}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{m.contenedor}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{m.dua}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{m.chofer}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{m.tracto}</td>
                  <td className="px-2 py-2 border-b max-w-[240px] truncate" title={m.observaciones}>{m.observaciones}</td>
                  <td className="px-2 py-2 border-b text-right">
                    <Button onClick={() => eliminarMovimiento(m.id)}>Eliminar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  const Inventario = () => (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <div className="flex gap-2 items-center">
          <h3 className="font-semibold text-gray-700">Saldos por Cliente y Producto</h3>
          <Chip>{saldos.length} líneas</Chip>
        </div>
        <div className="flex gap-2">
          <Button onClick={exportarSaldos}>Exportar CSV</Button>
        </div>
      </Toolbar>
      <div className="overflow-auto bg-white rounded-2xl border border-gray-100 shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left bg-gray-50">
              {["Cliente","Código","Producto","Unidad","Ingreso","Egreso","Saldo"].map((h) =>
                <th key={h} className="px-2 py-2 border-b border-gray-100 whitespace-nowrap text-gray-600">{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {saldos.map((r) => (
              <tr key={r.key} className="odd:bg-white even:bg-gray-50">
                <td className="px-2 py-2 border-b whitespace-nowrap">{r.cliente}</td>
                <td className="px-2 py-2 border-b whitespace-nowrap">{r.codigo}</td>
                <td className="px-2 py-2 border-b whitespace-nowrap">{r.producto}</td>
                <td className="px-2 py-2 border-b whitespace-nowrap">{r.unidad}</td>
                <td className="px-2 py-2 border-b text-right">{r.ingreso}</td>
                <td className="px-2 py-2 border-b text-right">{r.egreso}</td>
                <td className="px-2 py-2 border-b text-right font-semibold">{r.saldo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const Productos = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Card title="Nuevo producto">
        <div className="grid gap-3">
          <Input label="Código" value={prodForm.codigo} onChange={(e) => setProdForm({ ...prodForm, codigo: e.target.value })} />
          <Input label="Nombre" value={prodForm.nombre} onChange={(e) => setProdForm({ ...prodForm, nombre: e.target.value })} />
          <Input label="Unidad" value={prodForm.unidad} onChange={(e) => setProdForm({ ...prodForm, unidad: e.target.value })} />
          <div className="flex gap-2">
            <Button className="bg-gray-900 text-white border-gray-900" onClick={agregarProducto}>Agregar</Button>
            <Button onClick={() => setProdForm({ codigo: "", nombre: "", unidad: "saco" })}>Limpiar</Button>
          </div>
        </div>
      </Card>
      <Card title={`Productos (${store.productos.length})`} className="md:col-span-2">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left bg-gray-50">
                {["Código","Nombre","Unidad"].map((h) =>
                  <th key={h} className="px-2 py-2 border-b border-gray-100 whitespace-nowrap text-gray-600">{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {store.productos.map((p) => (
                <tr key={p.id} className="odd:bg-white even:bg-gray-50">
                  <td className="px-2 py-2 border-b whitespace-nowrap">{p.codigo}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{p.nombre}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{p.unidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  const Clientes = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Card title="Nuevo cliente">
        <div className="grid gap-3">
          <Input label="Nombre / Razón Social" value={cliForm.nombre} onChange={(e) => setCliForm({ ...cliForm, nombre: e.target.value })} />
          <Input label="RUC" value={cliForm.ruc} onChange={(e) => setCliForm({ ...cliForm, ruc: e.target.value })} />
          <div className="flex gap-2">
            <Button className="bg-gray-900 text-white border-gray-900" onClick={agregarCliente}>Agregar</Button>
            <Button onClick={() => setCliForm({ nombre: "", ruc: "" })}>Limpiar</Button>
          </div>
        </div>
      </Card>
      <Card title={`Clientes (${store.clientes.length})`} className="md:col-span-2">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left bg-gray-50">
                {["Nombre","RUC"].map((h) =>
                  <th key={h} className="px-2 py-2 border-b border-gray-100 whitespace-nowrap text-gray-600">{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {store.clientes.map((c) => (
                <tr key={c.id} className="odd:bg-white even:bg-gray-50">
                  <td className="px-2 py-2 border-b whitespace-nowrap">{c.nombre}</td>
                  <td className="px-2 py-2 border-b whitespace-nowrap">{c.ruc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  const Reportes = () => {
    const porCliente = useMemo(() => {
      const map = new Map();
      for (const r of saldos) map.set(r.cliente, (map.get(r.cliente) || 0) + r.saldo);
      return Array.from(map.entries()).map(([cliente, saldo]) => ({ cliente, saldo }));
    }, [saldos]);
    const porChofer = useMemo(() => {
      const map = new Map();
      store.movimientos.forEach((m) => {
        const key = m.chofer || "(sin chofer)";
        map.set(key, (map.get(key) || 0) + 1);
      });
      return Array.from(map.entries()).map(([chofer, viajes]) => ({ chofer, viajes }));
    }, [store.movimientos]);

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card title="Saldo total por cliente">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-2 py-2 border-b border-gray-100">Cliente</th>
                  <th className="px-2 py-2 border-b border-gray-100 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {porCliente.map((r) => (
                  <tr key={r.cliente} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-2 border-b">{r.cliente}</td>
                    <td className="px-2 py-2 border-b text-right font-semibold">{r.saldo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Viajes por chofer (conteo)">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-2 py-2 border-b border-gray-100">Chofer</th>
                  <th className="px-2 py-2 border-b border-gray-100 text-right">Movimientos</th>
                </tr>
              </thead>
              <tbody>
                {porChofer.map((r) => (
                  <tr key={r.chofer} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-2 border-b">{r.chofer}</td>
                    <td className="px-2 py-2 border-b text-right">{r.viajes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white text-gray-800">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <header className="flex flex-wrap items-center gap-3 justify-between mb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Mini‑ERP Inventario (Almacén)</h1>
            <div className="text-sm text-gray-500">{store.empresa?.nombre || "Define tu empresa en Configuración del código si deseas"}</div>
          </div>
          <nav className="flex gap-2">
            <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")}>Dashboard</TabButton>
            <TabButton active={tab === "movimientos"} onClick={() => setTab("movimientos")}>Movimientos</TabButton>
            <TabButton active={tab === "inventario"} onClick={() => setTab("inventario")}>Inventario</TabButton>
            <TabButton active={tab === "productos"} onClick={() => setTab("productos")}>Productos</TabButton>
            <TabButton active={tab === "clientes"} onClick={() => setTab("clientes")}>Clientes</TabButton>
            <TabButton active={tab === "reportes"} onClick={() => setTab("reportes")}>Reportes</TabButton>
          </nav>
        </header>

        {tab === "dashboard" && <Dashboard />}
        {tab === "movimientos" && <Movimientos />}
        {tab === "inventario" && <Inventario />}
        {tab === "productos" && <Productos />}
        {tab === "clientes" && <Clientes />}
        {tab === "reportes" && <Reportes />}

        <footer className="text-xs text-gray-400 mt-8">
          <p>Consejos: crea primero tus Clientes y Productos. Luego registra cada Ingreso/Egreso con fecha, guías, contenedor, DUA, chofer y tracto. Usa filtros para consultar y exporta CSV para Excel o Power BI.</p>
        </footer>
      </div>
    </div>
  );
}
