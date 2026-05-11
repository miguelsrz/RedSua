// ============================================================
// El backEnd calcula todos los indicadores: VPN, TIR, flujo y demas.
// Aca solo:
//  1. Se recoge los inputs: municipio, área, costo, parámetros avanzados si se quiere modificar
//  2. Llama a la API
//  3. Renderiza la respuesta: KPIs, gráficos, tabla, IA
// ============================================================

const API_BASE = "/api"; // URL relativa al estar en el CloudFront el origen del fronEntd (S3) y el backend (API Gateway/Lambda)

// Utilidades de formato 

const cop = n => // formateo de moneda colombiana sin decimales
  new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0,
  }).format(n);

const num = (n, d = 0) =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: d }).format(n);

const fmtM = v => // formateo de millones y miles
  Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}M`
  : cop(v);

// Carga de zonas (municipios y ciudades) al inicio 
async function cargarMunicipios() {
  try { // Se hace intento de fetch, pero si falla (como por ejemplo CORS o porque el backend presente error) se captura el error y se muestra una advertencia en consola, sin romper la funcionalidad del sitio
    const res  = await fetch(`${API_BASE}/municipios`, {
      headers: { "headerabc": "[#+PN1o8[&m{[7%!" },
    });
    const data = await res.json();
    const sel  = document.getElementById("dd-list");
    const srch = document.getElementById("dd-search");

    window._municipios = data.municipios || [];
    _renderMunicipios(window._municipios);

    // Buscador en tiempo real, que filtra la lista de municipios a medida que se escribe, buscando coincidencias parciales (includes) y sin importar mayúsculas o espacios al inicio/final
    srch.addEventListener("input", () => {
      const q = srch.value.toLowerCase().trim();
      _renderMunicipios(
        q ? window._municipios.filter(m => m.toLowerCase().includes(q))
          : window._municipios
      );
    });
  } catch (e) {
    console.warn("No se pudo cargar la lista de municipios:", e);
  }
}

function _renderMunicipios(lista) {
  const contenedorLista = document.getElementById("dd-list");
  const labelVisible = document.getElementById("dd-label");
  const inputOculto = document.getElementById("municipio");

  // Limpiamos la lista actual
  contenedorLista.innerHTML = "";

  lista.forEach(m => {
    // Creamos un div para cada municipio
    const item = document.createElement("div");
    item.className = "dd-item"; // Usamos la clase con padding que creamos en CSS
    item.textContent = m;

    // EVENTO AL HACER CLIC EN UN MUNICIPIO
    item.onclick = () => {
      // 1. Reflejar en pantalla (el label del dropdown)
      labelVisible.textContent = m;
      
      // 2. Guardar en el input oculto (este es el que se envía al backend) para que calcular() lo lea
      inputOculto.value = m;
      
      // 3. Cerrar el panel
      document.getElementById('dd-panel').classList.remove('open');
    };

    contenedorLista.appendChild(item);
  });
}

// Llamada a la API a la ruta que hace los calculos y se renderizan los resultados, con manejo de estados de carga y error. Es una función asíncrona que se activa al hacer clic en el botón "Calcular" o "Recalcular" 
async function calcular() {
  const btn     = document.getElementById("btnCalcular");
  const spinner = document.getElementById("spinner");
  const arrow   = document.getElementById("btn-arrow");
  const btnTxt  = document.getElementById("btn-text");
  const errMsg  = document.getElementById("errorMsg");
  const menIA =   document.getElementById("ia-texto");

  menIA.classList.add("hidden"); // Se oculta el contenedor de la recomendación IA al iniciar un nuevo cálculo, para que si el usuario hace cambios y recalcula, no se muestre una recomendación que ya no corresponde a los nuevos datos ingresados. La recomendación IA se volverá a mostrar una vez que se obtenga la nueva respuesta del backend con los nuevos datos y se haga la nueva petición a Gemini.
  errMsg.classList.add("hidden");
  btn.disabled          = true;
  spinner.style.display = "block";
  arrow.style.display   = "none";
  btnTxt.textContent    = "Calculando...";

  const payload = {
    ciudad:             document.getElementById("municipio").value,
    area_m2:            parseFloat(document.getElementById("area_m2").value),
    costo_instalacion:  parseFloat(document.getElementById("costo_instalacion").value),
    // Parámetros avanzados (opcionales)
    tasa_interes:       parseFloat(document.getElementById("tasa_interes").value) / 100,
    anos_proyecto:      parseInt(document.getElementById("anos_proyecto").value, 10),
    eficiencia_override: (() => {
      const v = parseFloat(document.getElementById("eficiencia").value) / 100;
      return isNaN(v) ? undefined : v;
    })(),
  };

  try { // Se hace intento de fetch, pero si falla (como por ejemplo CORS o porque el backend presente error) se captura el error y se muestra un mensaje amigable al usuario, sin romper la funcionalidad del sitio
    const response = await fetch(`${API_BASE}/calcular`, { // Se llama a la ruta /api/calcular del backend, que es la que hace todos los cálculos y devuelve los resultados para renderizar
      method:  "POST", // Es una petición POST porque se están enviando datos en el cuerpo (payload) con los inputs del usuario
      headers: { // Se incluyen los headers necesarios, incluyendo el header de autenticación que el backend espera para validar la petición (aunque en este caso es un valor fijo y no sensible, ya que el backend no tiene autenticación real implementada)
        "Content-Type": "application/json",
        "headerabc":    "[#+PN1o8[&m{[7%!",
      },
      body: JSON.stringify(payload), // El payload se convierte a JSON string para enviarlo en el cuerpo de la petición, y el backend lo recibirá y parseará para hacer los cálculos con esos datos
    });

    if (!response.ok) { // Si la respuesta no es exitosa (status code != 200 para este caso que es lo que maneja el backend como respuesta exitosa), se intenta extraer el mensaje de error del cuerpo de la respuesta, pero si eso falla (por ejemplo si el cuerpo no es JSON o no tiene un campo "error"), se lanza un error genérico indicando que hubo un problema con los campos ingresados
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `ERROR: Verifica campos ingresados`);
    }

    const d = await response.json(); // Si la respuesta es exitosa, se parsea el cuerpo como JSON para obtener los datos calculados por el backend, que incluyen todos los indicadores y resultados necesarios para renderizar en el frontend
    renderResultados(d); // Se llama a la función de renderizado de resultados, pasando los datos obtenidos del backend, para actualizar la interfaz con los KPIs, gráficos, tabla y recomendación IA basados en esos datos

    // Llamada independiente a /analisis para obtener la recomendación IA.
    // Se dispara después de renderizar para que los resultados económicos sean
    // visibles de inmediato y la IA cargue de forma asíncrona sin bloquear la UI.
    menIA.classList.remove("hidden"); // Se muestra el contenedor de la recomendación IA, que por defecto está oculto, para que una vez que se haga la petición a Gemini y se obtenga la respuesta, se pueda mostrar en ese contenedor. Si la petición a Gemini falla, el contenedor seguirá visible pero mostrará un mensaje indicando que no fue posible generar la recomendación IA.
    pedirAnalisisIA(d);

  } catch (e) { // Si ocurre cualquier error durante el proceso de fetch o procesamiento de la respuesta (como problemas de red, errores en el backend, o errores en el código), se captura el error y se muestra un mensaje amigable al usuario indicando que hubo un problema, sin mostrar detalles técnicos pero sugiriendo revisar los campos ingresados
    
    errMsg.textContent = `❌ Hubo un problema al calcular. Por favor, verifica los campos ingresados e intenta de nuevo.`;
    console.log(e.message); // Se imprime el mensaje de error en la consola para que los desarrolladores puedan ver detalles técnicos del error, pero el usuario solo verá el mensaje amigable definido arriba
    errMsg.classList.remove("hidden"); // Se muestra el mensaje de error en la interfaz, que por defecto está oculto con la clase "hidden", y al remover esa clase se hace visible para informar al usuario del problema ocurrido
  
  } finally { // Independientemente de si la petición fue exitosa o si ocurrió un error, se ejecuta este bloque para restablecer el estado del botón a su estado normal (habilitado, con el texto "Recalcular" y mostrando la flecha), para que el usuario pueda intentar calcular de nuevo si lo desea
    btn.disabled          = false;
    spinner.style.display = "none";
    arrow.style.display   = "";
    btnTxt.textContent    = "Recalcular";
  }
}

// Render de resultados 
let chartVPN = null, chartComp = null, chartEnerg = null; // Variables globales para almacenar las instancias de los gráficos, para poder destruirlos antes de crear nuevos al recalcular con diferentes datos, evitando así errores de Chart.js al intentar renderizar en un canvas que ya tiene un gráfico asociado sin destruirlo primero. Estas variables se asignarán con las instancias de los gráficos creados en la función renderResultados, y se verificarán antes de crear un nuevo gráfico para destruir el anterior si existe.

function renderResultados(d) {
  document.getElementById("estado-vacio").classList.add("hidden");
  document.getElementById("resultados").classList.remove("hidden");

  // Actualizar subtítulo del header con municipio
  const headerSub = document.getElementById("resultado-sub");
  if (headerSub) headerSub.textContent = `Análisis completado · ${d.ciudad}`;

  // Badge de viabilidad
  document.getElementById("badge-viable").innerHTML = d.viable
    ? `<span class="badge-viable badge-si">✅ Proyecto VIABLE - VPN positivo</span>`
    : `<span class="badge-viable badge-no">❌ No recomendado - VPN negativo</span>`;

  // Período de recuperación
  const periodoStr = d.periodo_rec !== null
    ? `${num(d.periodo_rec, 1)} años`
    : `> ${d.anos_proyecto} años`;

  // TIR es decir la tasa interna de retorno, que es un indicador financiero que representa la tasa de descuento a la cual el valor presente neto (VPN) de un proyecto es igual a cero. En otras palabras, es la tasa de rendimiento que hace que los ingresos futuros del proyecto sean equivalentes a la inversión inicial. Si la TIR es mayor que la tasa de interés utilizada para descontar los flujos de caja, se considera que el proyecto es rentable. En este código, se formatea la TIR como un porcentaje con un decimal, y si no es calculable (por ejemplo, si el proyecto no recupera la inversión), se muestra "No calculable". Además, se asigna un color verde si la TIR supera la tasa de interés, o rojo si está por debajo, para indicar visualmente si el resultado es favorable o no.
  const tirStr = d.tir !== null
    ? `${num(d.tir * 100, 1)}%`
    : "No calculable";

  const tirColor = d.tir !== null && d.tir > d.tasa_interes ? "green" : "red";

  // KPIs que son los indicadores clave que se muestran en la parte superior de los resultados, cada uno con su icono, valor formateado, subtítulo explicativo y color que indica su naturaleza (positivo, negativo, informativo). Estos KPIs se generan dinámicamente a partir de los datos calculados por el backend, y se renderizan en un grid de tarjetas para una visualización clara y atractiva de los resultados más importantes del análisis. Cada KPI tiene un formato específico para su valor (por ejemplo, moneda para ahorros y VPN, porcentaje para degradación), y el color ayuda a resaltar si el resultado es favorable o no.
  const kpis = [
    {
      icon: "⚡", label: "Energía generada",
      valor: `${num(d.energia_anual_kwh)} kWh`,
      sub: "Año 1 (base)", color: "amber",
    },
    {
      icon: "💰", label: "Ahorro anual",
      valor: cop(d.ahorro_anual_vp_cop),
      sub: "Año 1 (base)", color: "amber",
    },
    {
      icon: "📈", label: "VPN",
      valor: cop(d.vpn),
      sub: `Tasa ${num(d.tasa_interes * 100, 0)}% · ${d.anos_proyecto} años`,
      color: d.vpn >= 0 ? "green" : "red",
    },
    {
      icon: "🔁", label: "TIR",
      valor: tirStr,
      sub: d.tir !== null
        ? (d.tir > d.tasa_interes
            ? `Supera la tasa de interes (${num(d.tasa_interes * 100, 0)}%)`
            : `Por debajo de la tasa (${num(d.tasa_interes * 100, 0)}%)`)
        : "Proyecto no recuperable",
      color: tirColor,
    },
    {
      icon: "⏱", label: "Período de recuperación",
      valor: periodoStr,
      sub: "Inversión descontada", color: "blue",
    },
    {
      icon: "📉", label: "Degradación anual",
      valor: `${num(d.degradacion_anual * 100, 1)}%`,
      sub: "Pérdida de eficiencia/año", color: "neutral",
    },
  ];

  const colorMap = { // Definición de colores para cada tipo de KPI
    green:   { val: "#6EE7B7",       bg: "rgba(16,185,129,.07)",  border: "rgba(16,185,129,.2)"  },
    red:     { val: "#FCA5A5",       bg: "rgba(239,68,68,.07)",   border: "rgba(239,68,68,.2)"   },
    blue:    { val: "#93C5FD",       bg: "rgba(59,130,246,.07)",  border: "rgba(59,130,246,.2)"  },
    neutral: { val: "#A8A29E",       bg: "rgba(255,255,255,.04)", border: "rgba(255,255,255,.08)"},
    orange:  { val: "#F97316",       bg: "rgba(249, 115, 22, .08)",border: "rgba(249, 115, 22, .2)"},
  };

  document.getElementById("kpi-grid").innerHTML = kpis.map(k => {
    const c = colorMap[k.color] || colorMap["orange"];
    return `
    <div class="kpi-card" style="background:linear-gradient(135deg,${c.bg},rgba(28,25,23,.8));border:1px solid ${c.border};">
      <div style="font-size:1.4rem;margin-bottom:.5rem;">${k.icon}</div>
      <div class="kpi-value" style="color:${c.val};font-size:1.4rem;">${k.valor}</div>
      <div class="kpi-label" style="margin-top:.3rem;">${k.label}</div>
      ${k.sub ? `<div style="font-size:.65rem;color:#57534E;margin-top:.25rem;">${k.sub}</div>` : ""}
    </div>`;
  }).join("");

  // Datos para gráficas 
  const labels      = d.flujo_caja.map(f => `Año ${f.ano}`); // Etiquetas para el eje x de las gráficas, que se generan a partir del flujo de caja calculado por el backend, tomando el año de cada período y formateándolo como "Año 1", "Año 2", etc. Estas etiquetas permiten visualizar claramente en los gráficos la evolución de los indicadores a lo largo del tiempo del proyecto.
  const vpAcum      = d.flujo_caja.map(f => f.vp_acumulado_cop); // Datos para la gráfica de VP acumulado, que se generan a partir del flujo de caja calculado por el backend, tomando el valor presente acumulado en COP de cada período. Estos datos se utilizan para mostrar cómo evoluciona el valor presente neto del proyecto a lo largo del tiempo, permitiendo visualizar en qué momento el proyecto se vuelve rentable (cuando el VP acumulado cruza de negativo a positivo) y cómo se compara con la inversión inicial y los ahorros acumulados.
  const energias    = d.flujo_caja.map(f => f.energia_kwh); // Datos para la gráfica de energía generada por año, que se generan a partir del flujo de caja calculado por el backend, tomando la cantidad de energía generada en kWh de cada período. Estos datos se utilizan para mostrar la producción anual de energía del sistema solar, permitiendo visualizar cómo se degrada la producción a lo largo del tiempo debido a la degradación anual, y cómo contribuye a los ahorros y al valor presente neto del proyecto.

  // Para la gráfica comparativa de ahorro acumulado vs costo, se calcula el ahorro acumulado sumando el ahorro de cada período a medida que se avanza en el tiempo, y se crea una línea constante para el costo de instalación que se muestra como referencia. Esto permite visualizar claramente en la gráfica en qué momento el ahorro acumulado supera el costo de instalación, lo que indica el punto de equilibrio del proyecto.
  let ahorroAcum = 0;
  const ahorroAcumArr = d.flujo_caja.map(f => { ahorroAcum += f.ahorro_cop; return ahorroAcum; });
  const costoLine     = d.flujo_caja.map(() => d.costo_instalacion);

  // Gráfico 1: VP acumulado
  const ctx1 = document.getElementById("chart-vpn-acum");
  if (chartVPN) chartVPN.destroy();
  chartVPN = new Chart(ctx1, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "VP Acumulado (COP)",
          data: vpAcum,
          borderColor: "#F59E0B",
          backgroundColor: ctx => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 280);
            g.addColorStop(0, "rgba(245,158,11,.20)");
            g.addColorStop(1, "rgba(245,158,11,.01)");
            return g;
          },
          fill: true, tension: 0.4, borderWidth: 2.5,
          pointBackgroundColor: "#F59E0B", pointRadius: 3, pointHoverRadius: 6,
        },
        {
          label: "Punto de equilibrio",
          data: labels.map(() => 0),
          borderColor: "rgba(110,231,183,.5)",
          borderDash: [6, 4], borderWidth: 1.5,
          pointRadius: 0, fill: false,
        },
      ],
    },
    options: mkChartOpts("COP"),
  });

  // Gráfico 2: ahorro acumulado vs costo
  const ctx2 = document.getElementById("chart-comparativo");
  if (chartComp) chartComp.destroy();
  chartComp = new Chart(ctx2, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Costo del sistema solar (inversión)",
          data: costoLine,
          borderColor: "rgba(35,196,236,.7)",
          borderDash: [8, 4], borderWidth: 2,
          pointRadius: 0, fill: false, tension: 0,
        },
        {
          label: "Pago acumulado a la red (sin paneles)",
          data: ahorroAcumArr,
          borderColor: "rgba(228,19,19,.7)",
          fill: true, tension: 0.4, borderWidth: 2.5,
          pointBackgroundColor: "rgba(228,19,19,.7)", pointRadius: 3, pointHoverRadius: 6,
        },
      ],
    },
    options: mkChartOpts("COP"),
  });

  // Gráfico 3: energía por año
  const ctx3 = document.getElementById("chart-energia");
  if (chartEnerg) chartEnerg.destroy();
  chartEnerg = new Chart(ctx3, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Energía generada (kWh)",
        data: energias,
        backgroundColor: energias.map((_, i) =>
          `rgba(245,158,11,${0.85 - i * (0.45 / energias.length)})`),
        borderRadius: 5,
        borderSkipped: false,
      }],
    },
    options: {
      ...mkChartOpts("kWh"),
      plugins: { ...mkChartOpts("kWh").plugins, legend: { display: false } },
      scales: {
        x: { grid: { color: "rgba(255,255,255,.04)" }, ticks: { maxTicksLimit: 10 } },
        y: {
          grid: { color: "rgba(255,255,255,.04)" },
          ticks: { callback: v => `${num(v)} kWh` },
        },
      },
    },
  });

  // Tabla flujo de caja 
  let recuperado = false;
  document.getElementById("tabla-body").innerHTML = d.flujo_caja.map(f => {
    const esRec = !recuperado && f.vp_acumulado_cop >= 0;
    if (esRec) recuperado = true;
    return `<tr class="${esRec ? "row-recovered" : ""}">
      <td>${f.ano}</td>
      <td>${num(f.energia_kwh)}</td>
      <td>${cop(f.ahorro_cop)}</td>
      <td>${cop(f.ahorro_vp_cop)}</td>
      <td>${cop(f.vp_acumulado_cop)}</td>
    </tr>`;
  }).join("");

  // Scroll suave a resultados
  setTimeout(() => {
    document.getElementById("resultados").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 150);
}

// Opciones comunes de Chart.js 
function mkChartOpts(unidad) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "bottom",
        labels: { padding: 16, boxWidth: 12, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: "#1C1917",
        borderColor: "rgba(245,158,11,.2)",
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            const f = unidad === "COP" ? fmtM(v) : `${num(v)} ${unidad}`;
            return ` ${ctx.dataset.label}: ${f}`;
          },
        },
      },
    },
    scales: {
      x: { grid: { color: "rgba(255,255,255,.04)" }, ticks: { maxTicksLimit: 10 } },
      y: {
        grid: { color: "rgba(255,255,255,.04)" },
        ticks: { callback: v => unidad === "COP" ? fmtM(v) : `${num(v)} ${unidad}` },
      },
    },
  };
}

// Inicialización 
document.addEventListener("DOMContentLoaded", () => {
  cargarMunicipios();

  // Toggle de parámetros avanzados
  const toggleBtn   = document.getElementById("toggle-avanzado");
  const panelAvanc  = document.getElementById("panel-avanzado");
  if (toggleBtn && panelAvanc) {
    toggleBtn.addEventListener("click", () => {
      const abierto = !panelAvanc.classList.contains("hidden");
      panelAvanc.classList.toggle("hidden", abierto);
      toggleBtn.innerHTML = abierto
        ? `⚙️ Parámetros avanzados <span style="opacity:.5">(experimental)</span> ▾`
        : `⚙️ Parámetros avanzados <span style="opacity:.5">(experimental)</span> ▴`;
    });
  }
});

// LLAMADA A /analisis — recomendación IA de forma independiente
// Recibe el resultado completo de /calcular y lo envía a /analisis para que
// el backend llame a Gemini y devuelva la recomendación IA por separado.
// Mientras carga, muestra un indicador de carga en la sección de recomendación.
async function pedirAnalisisIA(resultado) {

  const contenedor = document.getElementById("ia-texto");
  if (!contenedor) return; // Si el elemento no existe en el HTML, no hace nada

  // Mostrar estado de carga mientras Gemini procesa
  contenedor.innerHTML = `
  <div class="ia-loading-dots">
              <span></span><span></span><span></span>
    </div>
    <span class="text-xs text-stone-600">Generando recomendación experta...</span>`;

  try {
    const response = await fetch(`${API_BASE}/analisis`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "headerabc":    "[#+PN1o8[&m{[7%!",
      },
      body: JSON.stringify(resultado), // Se envía el resultado completo de /calcular para que el backend construya el prompt con todos los datos del proyecto
    });

    if (!response.ok) throw new Error(`Error ${response.status}`);

    const data = await response.json();
    contenedor.re
    contenedor.innerHTML = data.recomendacion_ia
      ? data.recomendacion_ia.replace(/\n/g, "<br/>") // Renderizar saltos de línea del texto generado por Gemini
      : "No fue posible generar la recomendación IA.";

  } catch (e) {
    console.log("[IA error]", e.message);
    contenedor.innerHTML = `<span style="color:#78716C;font-style:italic;">No fue posible generar la recomendación IA en este momento.</span>`;
  }
}