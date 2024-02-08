const getData = (token) => {
  const encodedToken = btoa(token)
  return async (path) =>
    fetch(`https://api.octopus.energy/v1/${path}`, {
      headers: {
        Authorization: `Basic ${encodedToken}`
      }
    }).then((response) => response.json())
}

const getMeterPoints = (getData) => async (account) => {
  const data = await getData(`accounts/${account}`)
  return data.properties
    .flatMap((property) => property.electricity_meter_points)
    .filter((point) => !point.is_export)
}

const getUsage = (getData) => async (meterPoint, period_from, period_to) => {
  const results = {}
  for (const meter of meterPoint.meters) {
    const data = await getData(
      `electricity-meter-points/${meterPoint.mpan}/meters/${meter.serial_number}/consumption/?period_from=${period_from}&period_to=${period_to}`
    )
    if (data.results.length) {
      for (const { consumption, interval_start } of data.results) {
        results[interval_start] = consumption
      }
    }
  }
  return results
}

const getUnitRates =
  (getData) => async (meterPoint, period_from, period_to) => {
    const tariff_code =
      meterPoint.agreements[meterPoint.agreements.length - 1].tariff_code
    const product_code = tariff_code.split('-').slice(2, 6).join('-')
    const data = await getData(
      `products/${product_code}/electricity-tariffs/${tariff_code}/standard-unit-rates/?period_from=${period_from}&period_to=${period_to}`
    )
    const rates = {}
    for (const { valid_from, value_inc_vat } of data.results) {
      rates[valid_from] = value_inc_vat
    }
    return { tariff_code, rates: rates }
  }

const getAccountConsumption = async (
  account,
  token,
  period_from,
  period_to
) => {
  const getMyData = getData(token + ':')
  const meterPoints = await getMeterPoints(getMyData)(account)
  const meterPointConsumption = meterPoints.map(async (meterPoint) => {
    const usage = await getUsage(getMyData)(meterPoint, period_from, period_to)
    const unitRates = await getUnitRates(getMyData)(
      meterPoint,
      period_from,
      period_to
    )
    const consumptionCosts = Object.entries(usage)
      .reverse()
      .map(([interval_start, kwh]) => ({
        interval_start,
        kwh: kwh,
        rate: unitRates.rates[interval_start],
        cost: kwh * unitRates.rates[interval_start]
      }))
    let data = {}
    let totalCost = 0
    let totalKwh = 0
    let averageRate = 0
    for (const {
      interval_start,
      kwh,
      rate,
      cost
    } of consumptionCosts) {
      totalKwh += kwh
      totalCost += cost
      averageRate = totalCost / totalKwh
      data[interval_start] = {
        kwh,
        rate,
        cost,
        totalKwh,
        totalCost,
        averageRate
      }
    }
    return {
      tariff_code: unitRates.tariff_code,
      data
    }
  })
  return Promise.all(meterPointConsumption)
}
