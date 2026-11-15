document.addEventListener('DOMContentLoaded', () => {
  // --- 1. Menú Móvil Responsive ---
  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('active');
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => navLinks.classList.remove('active'));
    });
  }

  // --- 2. Utilidades de Direccionamiento IP ---
  function ipToInt(ip) {
    const parts = ip.trim().split('.');
    if (parts.length !== 4) return null;
    let num = 0;
    for (let i = 0; i < 4; i++) {
      if (parts[i] === '' || !/^\d+$/.test(parts[i])) return null;
      const octet = Number(parts[i]);
      if (octet < 0 || octet > 255) return null;
      num = (num << 8) | octet;
    }
    return num >>> 0;
  }

  function intToIp(int) {
    return [
      (int >>> 24) & 255,
      (int >>> 16) & 255,
      (int >>> 8) & 255,
      int & 255
    ].join('.');
  }

  function cidrToMask(cidr) {
    const maskInt = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
    return intToIp(maskInt);
  }

  // --- 3. Gestión Dinámica de Zonas VLSM ---
  const subnetsList = document.getElementById('subnetsList');
  const addSubnetBtn = document.getElementById('addSubnetBtn');

  addSubnetBtn.addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'subnet-row';
    const count = subnetsList.children.length + 1;
    row.innerHTML = `
      <input type="text" class="subnet-name" value="Zona ${count}" placeholder="Nombre de zona">
      <input type="number" class="subnet-hosts" value="10" min="1" placeholder="Hosts">
      <button type="button" class="btn-remove" title="Eliminar">✕</button>
    `;
    subnetsList.appendChild(row);
  });

  subnetsList.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-remove')) {
      if (subnetsList.children.length > 1) {
        e.target.parentElement.remove();
      }
    }
  });

  // --- 4. Calculadora VLSM (Fórmulas 9, 10 y 11 del PPT) ---
  function calcularVLSM() {
    const errorEl = document.getElementById('vlsmError');
    const resultsEl = document.getElementById('vlsmResults');
    errorEl.textContent = '';

    const baseIpStr = document.getElementById('baseIp').value;
    const baseCidr = parseInt(document.getElementById('baseCidr').value, 10);
    const rawIpInt = ipToInt(baseIpStr);

    if (rawIpInt === null || isNaN(baseCidr) || baseCidr < 8 || baseCidr > 30) {
      errorEl.textContent = 'Error: Ingresa una dirección IPv4 válida y un prefijo entre /8 y /30.';
      resultsEl.classList.add('hidden');
      return;
    }

    const baseMask = (0xffffffff << (32 - baseCidr)) >>> 0;
    const networkStart = (rawIpInt & baseMask) >>> 0;
    const totalAvailableIps = Math.pow(2, 32 - baseCidr);
    const networkEnd = (networkStart + totalAvailableIps - 1) >>> 0;

    const rows = document.querySelectorAll('.subnet-row');
    const subnets = [];
    for (const row of rows) {
      const name = row.querySelector('.subnet-name').value.trim() || 'Sin nombre';
      const hosts = parseInt(row.querySelector('.subnet-hosts').value, 10);
      if (isNaN(hosts) || hosts < 1) {
        errorEl.textContent = 'Error: Todas las zonas deben requerir al menos 1 dispositivo (host).';
        resultsEl.classList.add('hidden');
        return;
      }
      subnets.push({ name, hosts });
    }

    // Ordenar de mayor a menor demanda de hosts
    subnets.sort((a, b) => b.hosts - a.hosts);

    let currentIp = networkStart;
    let totalAllocated = 0;
    const allocatedSubnets = [];

    for (const sub of subnets) {
      // Fórmula 9: H = 2^n - 2 >= hosts
      let hostBits = 2;
      while (Math.pow(2, hostBits) - 2 < sub.hosts) {
        hostBits++;
      }
      // Fórmula 10: Máscara /(32 - n)
      const prefix = 32 - hostBits;
      // Fórmula 11: Bloque VLSM = 2^n direcciones
      const blockSize = Math.pow(2, hostBits);
      const usableHosts = blockSize - 2;
      const broadcastInt = (currentIp + blockSize - 1) >>> 0;

      if (broadcastInt > networkEnd) {
        errorEl.textContent = `Error: Espacio insuficiente en ${intToIp(networkStart)}/${baseCidr} para asignar "${sub.name}" (${sub.hosts} hosts).`;
        resultsEl.classList.add('hidden');
        return;
      }

      allocatedSubnets.push({
        name: sub.name,
        reqHosts: sub.hosts,
        usableHosts,
        blockSize,
        network: intToIp(currentIp),
        prefix: `/${prefix}`,
        mask: cidrToMask(prefix),
        firstHost: intToIp(currentIp + 1),
        lastHost: intToIp(broadcastInt - 1),
        broadcast: intToIp(broadcastInt)
      });

      totalAllocated += blockSize;
      currentIp = (broadcastInt + 1) >>> 0;
    }

    const tbody = document.querySelector('#vlsmTable tbody');
    tbody.innerHTML = allocatedSubnets.map(s => `
      <tr>
        <td><strong>${s.name}</strong></td>
        <td>${s.reqHosts}</td>
        <td>${s.usableHosts}</td>
        <td>${s.network}</td>
        <td>${s.prefix}</td>
        <td>${s.mask}</td>
        <td>${s.firstHost}</td>
        <td>${s.lastHost}</td>
        <td>${s.broadcast}</td>
      </tr>
    `).join('');

    const pctUsed = ((totalAllocated / totalAvailableIps) * 100).toFixed(1);
    document.getElementById('vlsmSummary').innerHTML = `
      <strong>Red Base Normalizada:</strong> ${intToIp(networkStart)}/${baseCidr} &nbsp;|&nbsp;
      <strong>Direcciones Totales:</strong> ${totalAvailableIps} &nbsp;|&nbsp;
      <strong>Asignadas:</strong> ${totalAllocated} (${pctUsed}%) &nbsp;|&nbsp;
      <strong>Libres:</strong> ${totalAvailableIps - totalAllocated}
    `;

    resultsEl.classList.remove('hidden');
    drawVlsmChart(allocatedSubnets, totalAvailableIps);
  }

  document.getElementById('calcVlsmBtn').addEventListener('click', calcularVLSM);

  function drawVlsmChart(subnets, totalIps) {
    const canvas = document.getElementById('vlsmChart');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const colors = ['#38bdf8', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#6366f1'];
    const padding = 35;
    const barHeight = 46;
    const barY = 55;
    const barWidth = canvas.width - padding * 2;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(padding, barY, barWidth, barHeight);
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(padding, barY, barWidth, barHeight);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px Segoe UI, sans-serif';
    ctx.fillText('Ocupación del Bloque de Direcciones IPv4 (Sin Solapamiento)', padding, 34);

    let currentX = padding;
    subnets.forEach((sub, idx) => {
      const w = Math.max((sub.blockSize / totalIps) * barWidth, 4);
      ctx.fillStyle = colors[idx % colors.length];
      ctx.fillRect(currentX, barY, w, barHeight);

      const legendX = padding + (idx % 3) * 250;
      const legendY = 135 + Math.floor(idx / 3) * 26;
      ctx.fillRect(legendX, legendY - 11, 14, 14);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '13px Segoe UI, sans-serif';
      ctx.fillText(`${sub.name} (${sub.prefix} - ${sub.blockSize} IPs)`, legendX + 22, legendY);

      currentX += w;
    });

    const usedIps = subnets.reduce((acc, s) => acc + s.blockSize, 0);
    const freeIps = totalIps - usedIps;
    const freeIdx = subnets.length;
    const legendX = padding + (freeIdx % 3) * 250;
    const legendY = 135 + Math.floor(freeIdx / 3) * 26;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(legendX, legendY - 11, 14, 14);
    ctx.strokeStyle = '#64748b';
    ctx.strokeRect(legendX, legendY - 11, 14, 14);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Espacio Libre (${freeIps} IPs)`, legendX + 22, legendY);
  }

  // --- 5. Calculadora Wi-Fi con Cálculo Integral (Fórmulas 1 a 8 del PPT) ---
  function calcularWiFi() {
    const errorEl = document.getElementById('wifiError');
    const resultsEl = document.getElementById('wifiResults');
    errorEl.textContent = '';

    const P0 = parseFloat(document.getElementById('txPower').value);
    const L0 = parseFloat(document.getElementById('refLoss').value);
    const a = parseFloat(document.getElementById('distA').value);
    const b = parseFloat(document.getElementById('distB').value);
    const n = parseFloat(document.getElementById('pathExponent').value);
    const lMuros = parseFloat(document.getElementById('obstaclesLoss').value);

    if ([P0, L0, a, b, n, lMuros].some(v => isNaN(v))) {
      errorEl.textContent = 'Error: Completa todos los campos numéricos del enlace Wi-Fi.';
      resultsEl.classList.add('hidden');
      return;
    }

    if (a <= 0 || b <= a) {
      errorEl.textContent = 'Error: La distancia inicial "a" debe ser mayor a 0 y menor que "b".';
      resultsEl.classList.add('hidden');
      return;
    }

    // Fórmula 3: L_dist = ∫_a^b A(x) dx = 10 * n * log10(b / a)
    const lDist = 10 * n * Math.log10(b / a);

    // Fórmula 1, 4 y 5: Pérdida total en b (d0 = 1 m)
    const lTotal = L0 + (10 * n * Math.log10(b / 1)) + lMuros;

    // Fórmula 6: Potencia recibida en el punto b: P(b) = P0 - L_total
    const pFinal = P0 - lTotal;

    // Fórmula 7: Potencia media en mW mediante Regla de Simpson compuesta
    const steps = 1000;
    const h = (b - a) / steps;
    const powerMwAt = (x) => {
      const lossAtX = L0 + (10 * n * Math.log10(x / 1)) + lMuros;
      const pDbmAtX = P0 - lossAtX;
      return Math.pow(10, pDbmAtX / 10);
    };

    let sum = powerMwAt(a) + powerMwAt(b);
    for (let i = 1; i < steps; i++) {
      const x = a + i * h;
      sum += (i % 2 === 0 ? 2 : 4) * powerMwAt(x);
    }
    const integralMw = (h / 3) * sum;
    const pMediaMw = integralMw / (b - a);

    // Fórmula 8: Potencia media en dBm = 10 * log10(P_media_mW)
    const pMediaDbm = 10 * Math.log10(pMediaMw);

    let quality = 'Excelente (Alta velocidad)';
    let qualityColor = '#10b981';
    if (pMediaDbm < -50 && pMediaDbm >= -67) {
      quality = 'Buena (Estable)';
      qualityColor = '#38bdf8';
    } else if (pMediaDbm < -67 && pMediaDbm >= -80) {
      quality = 'Débil (Posibles cortes)';
      qualityColor = '#f59e0b';
    } else if (pMediaDbm < -80) {
      quality = 'Crítica / Sin cobertura';
      qualityColor = '#ef4444';
    }

    document.getElementById('wifiKpis').innerHTML = `
      <div class="kpi-item">
        <span>Pérdida Tramo &int;<sub>a</sub><sup>b</sup> A(x)dx</span>
        <strong>${lDist.toFixed(2)} dB</strong>
      </div>
      <div class="kpi-item">
        <span>Pérdida Total en b (L<sub>total</sub>)</span>
        <strong>${lTotal.toFixed(2)} dB</strong>
      </div>
      <div class="kpi-item">
        <span>Potencia Media (P&#772;)</span>
        <strong>${pMediaDbm.toFixed(2)} dBm</strong>
        <small style="color:#94a3b8; display:block; font-size:0.75rem;">(${pMediaMw.toExponential(2)} mW)</small>
      </div>
      <div class="kpi-item">
        <span>Potencia en b / Estado</span>
        <strong style="color: ${qualityColor}; font-size: 1.15rem;">${pFinal.toFixed(2)} dBm</strong>
        <small style="color:${qualityColor}; display:block; font-size:0.78rem;">${quality}</small>
      </div>
    `;

    resultsEl.classList.remove('hidden');
    drawWifiChart(P0, L0, a, b, n, lMuros, pMediaDbm);
  }

  document.getElementById('calcWifiBtn').addEventListener('click', calcularWiFi);

  // --- 6. Gráfico Canvas Nativo Wi-Fi (Curva P(x) vs Potencia Media) ---
  function drawWifiChart(P0, L0, a, b, n, lMuros, pMediaDbm) {
    const canvas = document.getElementById('wifiChart');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const padL = 70, padR = 30, padT = 40, padB = 45;
    const w = canvas.width - padL - padR;
    const h = canvas.height - padT - padB;

    const samples = 80;
    const dataPoints = [];
    let minVal = Infinity;
    let maxVal = -Infinity;

    for (let i = 0; i <= samples; i++) {
      const x = a + ((b - a) / samples) * i;
      const lossX = L0 + (10 * n * Math.log10(x / 1)) + lMuros;
      const pX = P0 - lossX;
      dataPoints.push({ x, pX });
      if (pX < minVal) minVal = pX;
      if (pX > maxVal) maxVal = pX;
    }

    const yMax = Math.ceil(maxVal / 5) * 5 + 5;
    const yMin = Math.floor(minVal / 5) * 5 - 5;
    const yRange = (yMax - yMin) || 10;

    const getX = (dist) => padL + ((dist - a) / (b - a)) * w;
    const getY = (dbm) => padT + h - ((dbm - yMin) / yRange) * h;

    // Ejes y cuadrícula Y
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + h);
    ctx.lineTo(padL + w, padT + h);
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px Segoe UI, sans-serif';
    const stepsY = 5;
    for (let i = 0; i <= stepsY; i++) {
      const val = yMin + (yRange / stepsY) * i;
      const y = getY(val);
      ctx.fillText(`${val.toFixed(0)} dBm`, 10, y + 4);
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.3)';
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + w, y);
      ctx.stroke();
    }

    // Etiquetas eje X (distancia)
    const stepsX = 5;
    for (let i = 0; i <= stepsX; i++) {
      const dist = a + ((b - a) / stepsX) * i;
      const x = getX(dist);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`${dist.toFixed(1)}m`, x - 14, padT + h + 22);
    }

    // Curva P(x)
    ctx.beginPath();
    dataPoints.forEach((pt, idx) => {
      const x = getX(pt.x);
      const y = getY(pt.pX);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Línea punteada de Potencia Media Integral
    const yMean = getY(pMediaDbm);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(padL, yMean);
    ctx.lineTo(padL + w, yMean);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Leyenda superior
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(padL, 12, 14, 14);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '13px Segoe UI, sans-serif';
    ctx.fillText('Potencia Recibida P(x) [dBm]', padL + 20, 24);

    ctx.fillStyle = '#10b981';
    ctx.fillRect(padL + 230, 12, 14, 14);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`Potencia Media Integral (${pMediaDbm.toFixed(2)} dBm)`, padL + 250, 24);
  }

  // Ejecutar cálculos iniciales al cargar
  calcularVLSM();
  calcularWiFi();
});