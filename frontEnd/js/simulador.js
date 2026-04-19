// Reemplazar con la URL real de API Gateway
const API_BASE = "/api";

const cop = n =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

async function calcular() {
  const btn    = document.getElementById("btnCalcular");
  const errMsg = document.getElementById("errorMsg");
  const resDiv = document.getElementById("resultados");

  errMsg.classList.add("hidden");
  resDiv.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Calculando...";

  const payload = {
    ciudad:            "Bogota",
    area_m2:           parseFloat(document.getElementById("area_m2").value),
    costo_instalacion: parseFloat(document.getElementById("costo_instalacion").value),
  };

  try {
    const resp = await fetch(`${API_BASE}/calcular`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || `Error ${resp.status}`);
    }

    const data = await resp.json();
    renderResultados(data);

  } catch (e) {
    errMsg.textContent = `Error: ${e.message}`;
    errMsg.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Calcular";
  }
}

function renderResultados(d) {
  const kpis = [
    { label: "Ahorro anual estimado", valor: cop(d.ahorro_anual_cop) },
    { label: "Viable",               valor: d.viable ? "Si" : "No" },
  ];

  document.getElementById("kpiGrid").innerHTML = kpis.map(k => `
    <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
      <p class="text-xl font-bold text-blue-900">${k.valor}</p>
      <p class="text-xs text-slate-500 mt-1">${k.label}</p>
    </div>`).join("");

  document.getElementById("resultados").classList.remove("hidden");
}
