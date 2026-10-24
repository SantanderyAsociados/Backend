const test = require("node:test");
const assert = require("node:assert/strict");
const { calcularLiquidacion, prepararRegistroHoras } = require("./hours");

const registroBase = {
  fecha: "2026-06-01",
  hora_entrada: "07:00",
  hora_salida: "16:30",
  tipo: "normal",
  proyecto: "Puente de prueba",
  numero_proyecto: "PR-01",
  cliente: "Cliente de prueba",
};

test("calcula jornada normal descontando una hora de almuerzo", () => {
  const registro = prepararRegistroHoras(registroBase);
  assert.equal(registro.tiempo_estimado, 8.5);
});

test("calcula vacaciones como nueve horas en día hábil", () => {
  const registro = prepararRegistroHoras({ fecha: "2026-06-01", tipo: "vacaciones" });
  assert.equal(registro.tiempo_estimado, 9);
  assert.equal(registro.proyecto, "Vacaciones");
});

test("no permite vacaciones durante el fin de semana", () => {
  const registro = prepararRegistroHoras({ fecha: "2026-06-07", tipo: "vacaciones" });
  assert.match(registro.error, /días hábiles/);
});

test("festivo registra cero horas y no genera liquidación", () => {
  const registro = prepararRegistroHoras({ fecha: "2026-06-01", tipo: "festivo" });
  assert.equal(registro.tiempo_estimado, 0);
  assert.equal(calcularLiquidacion(registro.tiempo_estimado, 1750000, "festivo", registro.fecha), 0);
});

test("aplica recargo dominical del 75 por ciento", () => {
  const pago = calcularLiquidacion(8, 1750000, "normal", "2026-06-07");
  assert.equal(pago, 140000);
});

test("requiere proyecto, número de proyecto y cliente para jornada normal", () => {
  const registro = prepararRegistroHoras({
    ...registroBase,
    proyecto: "",
    numero_proyecto: "",
    cliente: "",
  });
  assert.match(registro.error, /número de proyecto/);
});

test("rechaza jornadas que no superan la hora de almuerzo", () => {
  const registro = prepararRegistroHoras({
    ...registroBase,
    hora_entrada: "08:00",
    hora_salida: "09:00",
  });
  assert.match(registro.error, /superar una hora/);
});
