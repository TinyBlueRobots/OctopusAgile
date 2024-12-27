type AccountData = {
  properties: {
    electricity_meter_points: {
      is_export: boolean
      mpan: string
      meters: { serial_number: string }[]
    }[]
  }[]
}

type MeterData = {
  results: {
    consumption: number
    interval_start: string
    interval_end: string
  }[]
}

export type Consumption = { [serialNumber: string]: { periodFrom: Date; periodTo: Date; value: number }[] }

type Tariffs = {
  results: {
    display_name: string
    brand: string
    links: { rel: string; href: string }[]
  }[]
}

type TariffData = {
  single_register_electricity_tariffs: {
    [region: string]: { direct_debit_monthly: { links: { rel: string; href: string }[] } }
  }
}

type RegionUnitRates = {
  results: {
    valid_from: string
    value_inc_vat: number
  }[]
}

export type Rate = { periodFrom: Date; price: number }

const apiCache: { [key: string]: string } = {}
const apiRoot = 'https://api.octopus.energy/v1/'

const getPeriodTo = (periodFrom: Date) => {
  const periodTo = new Date(periodFrom)
  periodTo.setDate(periodTo.getDate() + 1)
  return periodTo
}

const getData = async <T>(path: string, token?: string): Promise<T> => {
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Basic ${btoa(token)}`
  }
  const cacheKey = `${path} ${JSON.stringify(headers)}`
  if (apiCache[cacheKey]) {
    return JSON.parse(apiCache[cacheKey]) as T
  }
  const response = await fetch(path, { headers: headers })
  if (response.ok) {
    if (Object.keys(apiCache).length >= 10) {
      delete apiCache[Object.keys(apiCache)[0]]
    }
    const data = await response.json()
    apiCache[cacheKey] = JSON.stringify(data)
    return data as T
  }
  throw new Error(response.statusText)
}

export const getAccountData = async (account: string, token: string) =>
  await getData<AccountData>(`${apiRoot}accounts/${account}/`, token)

export const getMeterConsumption = async (account: string, token: string, periodFrom: Date) => {
  const periodTo = getPeriodTo(periodFrom)
  const accountData = await getAccountData(account, token)
  if (!accountData) return null
  const meterPoints = accountData.properties
    .flatMap((property) => property.electricity_meter_points)
    .filter((point) => !point.is_export)
  const meterConsumption: Consumption = {}
  const meters = meterPoints.flatMap((point) =>
    point.meters.map((meter) => ({ mpan: point.mpan, serialNumber: meter.serial_number }))
  )
  await Promise.all(
    meters.map(async ({ mpan, serialNumber }) => {
      const meterData = await getData<MeterData>(
        `${apiRoot}electricity-meter-points/${mpan}/meters/${serialNumber}/consumption?period_from=${periodFrom.toISOString()}&period_to=${periodTo.toISOString()}`,
        token
      )
      if (meterData && meterData.results.length) {
        meterConsumption[serialNumber] = []
        for (const { consumption, interval_start, interval_end } of meterData.results) {
          meterConsumption[serialNumber].push({
            periodFrom: new Date(interval_start),
            periodTo: new Date(interval_end),
            value: consumption
          })
        }
        meterConsumption[serialNumber] = meterConsumption[serialNumber]
          .sort(
            ({ periodFrom: periodFrom1 }, { periodFrom: periodFrom2 }) => periodFrom1.getTime() - periodFrom2.getTime()
          )
          .slice(0, 48)
      }
    })
  )
  return Object.keys(meterConsumption).length ? meterConsumption : null
}

export const getRates = async (region: string, periodFrom: Date) => {
  const periodTo = getPeriodTo(periodFrom)
  const tariffs = await getData<Tariffs>(`${apiRoot}products/`)
  const agileTariff = tariffs.results.find(
    (tariff) => tariff.display_name === 'Agile Octopus' && tariff.brand === 'OCTOPUS_ENERGY'
  )
  const agileTariffDataHref = agileTariff?.links.find((link) => link.rel === 'self')?.href
  if (!agileTariffDataHref) {
    return []
  }
  const tariffData = await getData<TariffData>(agileTariffDataHref)
  const regionTariff = tariffData.single_register_electricity_tariffs[`_${region}`]
  if (!regionTariff) {
    return []
  }
  const regionUnitRatesHref =
    regionTariff.direct_debit_monthly.links.find((link) => link.rel === 'standard_unit_rates')?.href +
    `?period_from=${periodFrom.toISOString()}&period_to=${periodTo.toISOString()}`
  if (!regionUnitRatesHref) {
    return []
  }
  const regionUnitRates = await getData<RegionUnitRates>(regionUnitRatesHref)
  return regionUnitRates.results.reverse().map(
    ({ valid_from, value_inc_vat }) =>
      ({
        periodFrom: new Date(valid_from),
        price: value_inc_vat
      } as Rate)
  )
}
