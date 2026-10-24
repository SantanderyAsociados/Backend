const TIPOS_REGISTRO_HORAS = new Set(["normal", "sabado", "domingo", "festivo", "vacaciones"]);

function esFechaIsoValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const fechaUtc = new Date(`${fecha}T00:00:00Z`);
  return Number.isFinite(fechaUtc.getTime()) && fechaUtc.toISOString().slice(0, 10) === fecha;
}

function prepararRegistroHoras(body = {}) {
  const fecha = typeof body.fecha === "string" ? body.fecha.trim() : "";
  const tipo = typeof body.tipo === "string" ? body.tipo.trim() : "normal";
  const esDiaEspecial = tipo === "festivo" || tipo === "vacaciones";
  const horaEntrada = esDiaEspecial
    ? "00:00"
    : (typeof body.hora_entrada === "string" ? body.hora_entrada.trim() : "");
  const horaSalida = esDiaEspecial
    ? "00:00"
    : (typeof body.hora_salida === "string" ? body.hora_salida.trim() : "");
  const clienteIngresado = typeof body.cliente === "string" ? body.cliente.trim() : "";
  const proyectoIngresado = typeof body.proyecto === "string" ? body.proyecto.trim() : "";
  const numeroProyecto = typeof body.numero_proyecto === "string" ? body.numero_proyecto.trim() : "";
  const dia = esFechaIsoValida(fecha)
    ? new Date(`${fecha}T00:00:00Z`).getUTCDay()
    : -1;

  if (!esFechaIsoValida(fecha) || !TIPOS_REGISTRO_HORAS.has(tipo)) {
    return { error: "La fecha o el tipo de jornada no son válidos" };
  }

  let horasTrabajadas = 0;
  if (tipo === "vacaciones") {
    if (dia === 0 || dia === 6) {
      return { error: "Las vacaciones solo se pueden registrar en días hábiles" };
    }
    horasTrabajadas = 9;
  } else if (tipo !== "festivo") {
    const horaValida = (hora) => /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
    if (!horaValida(horaEntrada) || !horaValida(horaSalida) || horaSalida <= horaEntrada) {
      return { error: "La hora de salida debe ser posterior a la hora de entrada" };
    }

    const [horaInicio, minutoInicio] = horaEntrada.split(":").map(Number);
    const [horaFin, minutoFin] = horaSalida.split(":").map(Number);
    const minutosNetos = (horaFin * 60 + minutoFin) - (horaInicio * 60 + minutoInicio) - 60;
    if (minutosNetos <= 0) {
      return { error: "La jornada debe superar una hora para descontar el almuerzo" };
    }
    horasTrabajadas = Number((minutosNetos / 60).toFixed(2));
  }

  if (!esDiaEspecial && (!clienteIngresado || !proyectoIngresado || !numeroProyecto)) {
    return { error: "Selecciona un proyecto y un cliente e indica el número de proyecto" };
  }

  const cliente = esDiaEspecial ? "N/A" : clienteIngresado;
  const proyecto = esDiaEspecial
    ? (tipo === "festivo" ? "Día Festivo" : "Vacaciones")
    : proyectoIngresado;
  const numeroProyectoFinal = esDiaEspecial ? "" : numeroProyecto;
  if (cliente.length > 180 || proyecto.length > 180 || numeroProyectoFinal.length > 80) {
    return { error: "El cliente, proyecto o número de proyecto supera la longitud permitida" };
  }

  return {
    fecha,
    hora_entrada: horaEntrada,
    hora_salida: horaSalida,
    cliente,
    proyecto,
    numero_proyecto: numeroProyectoFinal,
    tipo,
    tiempo_estimado: horasTrabajadas,
  };
}

function calcularLiquidacion(horasTrabajadas, sueldoMensual, tipo, fecha) {
  const horas = Number(horasTrabajadas) || 0;
  const sueldo = Number(sueldoMensual) || 0;
  if (!esFechaIsoValida(fecha) || tipo === "festivo") return 0;

  const esDomingo = tipo === "domingo" || new Date(`${fecha}T00:00:00Z`).getUTCDay() === 0;
  const recargo = esDomingo ? 1.75 : 1;
  return Number((horas * (sueldo / 175) * recargo).toFixed(2));
}

module.exports = { prepararRegistroHoras, calcularLiquidacion };
