// CONFIG
const API_BASE = "/api"; 

// Parametros económicos fijos para Bogota solo para primera version
const TASA_INTERES      = 0.12;   // 12% anual
const ANOS_PROYECTO     = 20;     // vida útil del sistema
const DEGRADACION_ANUAL = 0.005;  // 0.5% pérdida de eficiencia por año

// Datos locales de Bogotá para la vista previa sin tener que llamar a API
const BOGOTA_LOCAL = { radiacion: 3.5, eficiencia: 0.18, tarifa: 800 };

// UTILIDADES DE FORMATO
const cop = n =>
  new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", maximumFractionDigits: 0
  }).format(n);

const num = (n, d = 0) =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: d }).format(n);

const fmtM = v => // COP abreviado 
  Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}M`
  : cop(v);


// CALCULO
// De entrada son los 3 valores de la API que son energia_anual_kwh, ahorro_anual_cop, viable
// De salida son objeto completo con VPN, período de recuperación, flujo de caja

/**
 * Construye el análisis económico a partir de los 3 datos de la API.
 *
 * Se usan las fórmulas del docs y derivados:
 *   Energía año k = energiaBase × (1 − degradación)^k
 *   Ahorro año k  = Energía año k × tarifa
 *   VP año k      = Ahorro año k / (1 + i)^k
 *   VPN           = Σ VP_k − costo
 *   P (serie uniforme) = A × [(1 − (1+i)^−n) / i]
 */

function construirAnalisis(energiaAnualKwh, ahorroAnualCop, costo) {
  const i     = TASA_INTERES;
  const n     = ANOS_PROYECTO;
  const deg   = DEGRADACION_ANUAL;

  // Tarifa implícita (COP/kWh) derivada de los 2 valores de la API
  const tarifaImplicita = energiaAnualKwh > 0 ? ahorroAnualCop / energiaAnualKwh : 800;

  // Flujo de caja año a año
  const flujoCaja   = [];
  let vpAcumulado   = -costo;
  let periodoRec    = null;

  for (let k = 1; k <= n; k++) {
    const energiaK = energiaAnualKwh * Math.pow(1 - deg, k);
    const ahorroK  = energiaK * tarifaImplicita;
    const vpK      = ahorroK / Math.pow(1 + i, k);
    vpAcumulado   += vpK;

    // Período de recuperación
    if (periodoRec === null && vpAcumulado >= 0) {
      const vpAnterior = vpAcumulado - vpK;
      periodoRec = (k - 1) + (-vpAnterior / vpK);
    }

    flujoCaja.push({
      ano:             k,
      energiaKwh:      energiaK,
      ahorroCop:       ahorroK,
      ahorroVpCop:     vpK,
      vpAcumuladoCop:  vpAcumulado,
    });
  }

  // Indicadores globales
  const vpn = vpAcumulado;                       // Σ VP_k − costo

  // VP por fórmula de serie uniforme
  const factorPA = i > 0 ? (1 - Math.pow(1 + i, -n)) / i : n;
  const vpSerieUniforme = ahorroAnualCop * factorPA - costo;

  return {
    // Datos base de la API
    energiaAnualKwh,
    ahorroAnualCop,
    costo,
    // Indicadores calculados en JS
    vpn:               Math.round(vpn),
    periodoRec:        periodoRec !== null ? periodoRec : null,
    viable:            vpn > 0,
    // Desglose
    tarifaImplicita,
    degradacionAnual:  deg,
    tasaInteres:       i,
    anosProyecto:      n,
    vpSerieUniforme:   Math.round(vpSerieUniforme),
    // Flujo de caja completo
    flujoCaja,
  };
}


// LLAMADA A LA API
async function calcular() {
  const btn     = document.getElementById("btnCalcular");
  const spinner = document.getElementById("spinner");
  const arrow   = document.getElementById("btn-arrow");
  const btnTxt  = document.getElementById("btn-text");
  const errMsg  = document.getElementById("errorMsg");

  errMsg.classList.add("hidden");
  btn.disabled          = true;
  spinner.style.display = "block";
  arrow.style.display   = "none";
  btnTxt.textContent    = "Calculando...";

  const payload = {
    ciudad:            "Bogota",
    area_m2:           parseFloat(document.getElementById("area_m2").value),
    costo_instalacion: parseFloat(document.getElementById("costo_instalacion").value),
  };

  try {
    const response = await fetch(`${API_BASE}/calcular`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Error del servidor (${response.status})`);
    }

    // Se reciben los 3 resultados de la API
    // { energia_anual_kwh, ahorro_anual_cop, viable }
    const apiData = await response.json();

    // Se construye el análisis
    const analisis = construirAnalisis(
      apiData.energia_anual_kwh,
      apiData.ahorro_anual_cop,
      payload.costo_instalacion
    );

    renderResultados(analisis);

  } catch (e) {
    errMsg.textContent = `❌ ${e.message}`;
    errMsg.classList.remove("hidden");
  } finally {
    btn.disabled          = false;
    spinner.style.display = "none";
    arrow.style.display   = "";
    btnTxt.textContent    = "Recalcular";
  }
}

// RENDER RESULTADOS

// Instancias Chart.js
let chartVPN = null, chartComp = null, chartEnerg = null;

function renderResultados(d) {
  document.getElementById("estado-vacio").classList.add("hidden");
  document.getElementById("resultados").classList.remove("hidden");

  // Badge viable
  document.getElementById("badge-viable").innerHTML = d.viable
    ? `<span class="badge-viable badge-si">✅ Proyecto VIABLE - VPN positivo</span>`
    : `<span class="badge-viable badge-no">❌ No recomendado - VPN negativo</span>`;

  // KPIs
  const periodoStr = d.periodoRec !== null
    ? `${num(d.periodoRec, 1)} años`
    : `> ${d.anosProyecto} años`;

  const kpis = [
    {
      icon:  "⚡",
      label: "Energía generada",
      valor: `${num(d.energiaAnualKwh)} kWh`,
      sub:   "Año 1 (base)",
      color: "amber",
    },
    {
      icon:  "💰",
      label: "Ahorro anual",
      valor: cop(d.ahorroAnualCop),
      sub:   "Año 1 (base)",
      color: "amber",
    },
    {
      icon:  "📈",
      label: "VPN",
      valor: cop(d.vpn),
      sub:   `Tasa ${num(d.tasaInteres * 100, 0)}% · ${d.anosProyecto} años`,
      color: d.vpn >= 0 ? "green" : "red",
    },
    {
      icon:  "⏱",
      label: "Período de recuperación",
      valor: periodoStr,
      sub:   "Inversión descontada",
      color: "blue",
    },
    {
      icon:  "📉",
      label: "Degradación anual",
      valor: `${num(d.degradacionAnual * 100, 1)}%`,
      sub:   "Pérdida de eficiencia/año",
      color: "neutral",
    },
  ];

  const colorMap = {
    amber:   { val: "var(--amber)",    bg: "rgba(245,158,11,.07)",  border: "rgba(245,158,11,.18)" },
    green:   { val: "#6EE7B7",         bg: "rgba(16,185,129,.07)",  border: "rgba(16,185,129,.2)"  },
    red:     { val: "#FCA5A5",         bg: "rgba(239,68,68,.07)",   border: "rgba(239,68,68,.2)"   },
    blue:    { val: "#93C5FD",         bg: "rgba(59,130,246,.07)",  border: "rgba(59,130,246,.2)"  },
    neutral: { val: "#A8A29E",         bg: "rgba(255,255,255,.04)", border: "rgba(255,255,255,.08)"},
  };

  document.getElementById("kpi-grid").innerHTML = kpis.map(k => {
    const c = colorMap[k.color];
    return `
    <div class="kpi-card" style="background:linear-gradient(135deg,${c.bg},rgba(28,25,23,.8));border-color:${c.border};">
      <div style="font-size:1.4rem;margin-bottom:.5rem;">${k.icon}</div>
      <div class="kpi-value" style="color:${c.val};font-size:1.4rem;">${k.valor}</div>
      <div class="kpi-label" style="margin-top:.3rem;">${k.label}</div>
      ${k.sub ? `<div style="font-size:.65rem;color:#57534E;margin-top:.25rem;">${k.sub}</div>` : ""}
    </div>`;
  }).join("");

  // Datos para gráficos
  const labels     = d.flujoCaja.map(f => `Año ${f.ano}`);
  const vpAcum     = d.flujoCaja.map(f => f.vpAcumuladoCop);
  const energias   = d.flujoCaja.map(f => f.energiaKwh);

  // Ahorro acumulado sin descontar
  let ahorroAcum = 0;
  const ahorroAcumArr = d.flujoCaja.map(f => {
    ahorroAcum += f.ahorroCop;
    return ahorroAcum;
  });
  const costoLine = d.flujoCaja.map(() => d.costo); // línea plana del costo

  // Gráfico 1: VP Acumulado
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

  // Gráfico 2: Ahorro acumulado vs costo solar
  const ctx2 = document.getElementById("chart-comparativo");
  if (chartComp) chartComp.destroy();
  chartComp = new Chart(ctx2, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Costo sistema solar (inversión)",
          data: costoLine,
          borderColor: "rgba(35, 196, 236, 0.7)",
          borderDash: [8, 4], borderWidth: 2,
          pointRadius: 0, fill: false, tension: 0,
        },
        {
          label: "Pago acumulado a la red electrica (sin paneles)",
          data: ahorroAcumArr,
          borderColor: "rgba(228, 19, 19, 0.7)",
          fill: true, tension: 0.4, borderWidth: 2.5,
          pointBackgroundColor: "rgba(228, 19, 19, 0.7)", pointRadius: 3, pointHoverRadius: 6,
        },
      ],
    },
    options: mkChartOpts("COP"),
  });

  // Gráfico 3: Energía por año
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
      plugins: {
        ...mkChartOpts("kWh").plugins,
        legend: { display: false },
      },
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
  document.getElementById("tabla-body").innerHTML = d.flujoCaja.map(f => {
    const esRec = !recuperado && f.vpAcumuladoCop >= 0;
    if (esRec) recuperado = true;
    return `<tr class="${esRec ? "row-recovered" : ""}">
      <td>${f.ano}</td>
      <td>${num(f.energiaKwh)}</td>
      <td>${cop(f.ahorroCop)}</td>
      <td>${cop(f.ahorroVpCop)}</td>
      <td>${cop(f.vpAcumuladoCop)}</td>
    </tr>`;
  }).join("");

  // Interpretación
  const textos = [];

  textos.push(d.viable
    ? `✅ <strong style="color:#6EE7B7">El proyecto es viable.</strong> El VPN de ${cop(d.vpn)} es positivo, lo que significa que la inversión genera riqueza real por encima de la tasa de oportunidad ('i' dado) del ${num(d.tasaInteres * 100, 0)}%.`
    : `❌ <strong style="color:#FCA5A5">El proyecto no es viable</strong> bajo los supuestos actuales. El VPN de ${cop(d.vpn)} es negativo. Considera reducir el costo de instalación o aumentar el área de paneles.`
  );

  if (d.periodoRec !== null) {
    textos.push(`(1). La inversión se recupera en aproximadamente <strong style="color:#93C5FD">${num(d.periodoRec, 1)} años</strong>. A partir de ese momento, cada año genera un ahorro neto positivo descontado.`);
  } else {
    textos.push(`(1). Con los parámetros actuales, la inversión <strong style="color:#FCA5A5">no se recupera</strong> en los ${d.anosProyecto} años del proyecto.`);
  }

  textos.push(`(2). La degradación anual del ${num(d.degradacionAnual * 100, 1)}% de los paneles está incorporada en para la proyección de ${d.anosProyecto} años. `);

  textos.push(`(3). El VPN calculado con la fórmula de serie uniforme (P = A·[(1−(1+i)⁻ⁿ)/i]) es ${cop(d.vpSerieUniforme)}.`);

  textos.push(`Nota: Los ahorros y tiempos de recuperación proyectados muestran el valor equivalente de la energía generada, asumiendo un 100% de autoconsumo solar.`);
  document.getElementById("interpretacion-texto").innerHTML =
    textos.map(t => `<p>${t}</p>`).join("");

  // Scroll suave
  setTimeout(() => {
    document.getElementById("resultados").scrollIntoView({ behavior: "smooth", block: "start" });
  }, 150);
}

// OPCIONES DE GRÁFICO

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
        ticks: {
          callback: v => unidad === "COP" ? fmtM(v) : `${num(v)} ${unidad}`,
        },
      },
    },
  };
}