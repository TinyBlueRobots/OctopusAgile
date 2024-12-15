const regionMap = {
  A: 'Eastern England',
  B: 'East Midlands',
  C: 'London',
  D: 'North Wales, Merseyside and Cheshire',
  E: 'West Midlands',
  F: 'North East England',
  G: 'North West England',
  H: 'Southern England',
  J: 'South East England',
  K: 'South Wales',
  L: 'South West England',
  M: 'Yorkshire',
  N: 'Southern Scotland',
  P: 'Northern Scotland'
}

let existingChart

const apiRoot = 'https://api.octopus.energy/v1/'

const getPeriodTo = (period_from) => {
  const period_to = new Date(period_from)
  period_to.setDate(period_to.getDate() + 1)
  return period_to
}

const getData = async (path, token) => {
  headers = token ? { Authorization: `Basic ${btoa(token)}` } : {}
  const response = await fetch(path, { headers: headers })
  return response.ok ? await response.json() : null
}

const getConsumption = async (account, token, period_from) => {
  const period_to = getPeriodTo(period_from)
  const accountData = await getData(`${apiRoot}accounts/${account}/`, token)
  if (!accountData) return null
  const meterPoints = accountData.properties
    .flatMap((property) => property.electricity_meter_points)
    .filter((point) => !point.is_export)
  const meterConsumption = {}
  for (const meterPoint of meterPoints) {
    for (const meter of meterPoint.meters) {
      const consumptionData = await getData(
        `${apiRoot}electricity-meter-points/${meterPoint.mpan}/meters/${
          meter.serial_number
        }/consumption?period_from=${period_from.toISOString()}&period_to=${period_to.toISOString()}`,
        token
      )
      if (consumptionData && consumptionData.results.length) {
        meterConsumption[meter.serial_number] = {}
        for (const { consumption, interval_start } of consumptionData.results) {
          meterConsumption[meter.serial_number][interval_start] = consumption
        }
      }
    }
  }
  return meterConsumption
}

const getRates = async (region, period_from) => {
  const period_to = getPeriodTo(period_from)
  const tariffs = await getData(`${apiRoot}products/`)
  const agileTariffDataHref = tariffs.results
    .find(
      (tariff) =>
        tariff.display_name === 'Agile Octopus' &&
        tariff.brand === 'OCTOPUS_ENERGY'
    )
    .links.find((link) => link.rel === 'self').href
  const tariffData = await getData(agileTariffDataHref)
  const regionUnitRatesHref =
    tariffData.single_register_electricity_tariffs[
      `_${region}`
    ].direct_debit_monthly.links.find(
      (link) => link.rel === 'standard_unit_rates'
    ).href +
    `?period_from=${period_from.toISOString()}&period_to=${period_to.toISOString()}`
  const regionUnitRates = await getData(regionUnitRatesHref)
  return regionUnitRates.results.map(({ valid_from, value_inc_vat }) => ({
    valid_from,
    value_inc_vat
  }))
}

const getConsumptionCosts = async (rates, consumption) => {
  const ratesMap = {}
  for (const rate of Object.values(rates)) {
    ratesMap[rate.valid_from] = rate.value_inc_vat
  }
  for (const serial_number of Object.keys(consumption)) {
    for (const [period, kwh] of Object.entries(consumption[serial_number])) {
      const ratesForPeriod = ratesMap[period]
      if (ratesForPeriod) {
        consumption[serial_number][period] = kwh * ratesForPeriod
      }
    }
  }
  return consumption
}

const formatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

const createChartOptions = async (region, period_from, consumption) => {
  const rates = await getRates(region, period_from)
  const results = rates.reverse()
  const prices = results.map((rate) => rate.value_inc_vat.toFixed(2))
  const series = [{ name: 'Price', data: prices }]
  consumption = consumption ? await getConsumptionCosts(rates, consumption) : {}
  for (const serial_number of Object.keys(consumption)) {
    const consumptionCosts = Object.values(consumption[serial_number]).reverse()
    if (consumptionCosts.length) {
      series.push({
        name: `Meter ${serial_number}`,
        data: consumptionCosts.map((cost) => cost.toFixed(2))
      })
    }
  }
  const dates = results.map((rate) => rate.valid_from)
  const times = dates.map((date) => date.slice(11, 16))
  const options = {
    colors: ['rgb(250, 152, 255)', 'rgb(16, 195, 149)'],
    series,
    chart: {
      height: '100%',
      type: 'line',
      zoom: {
        enabled: false
      }
    },
    legend: {
      show: true,
      showForSingleSeries: true,
      labels: {
        colors: 'azure'
      }
    },
    dataLabels: {
      enabled: false
    },
    grid: {
      strokeDashArray: 3
    },
    stroke: {
      curve: 'straight'
    },
    title: {
      text: formatter.format(period_from),
      align: 'center',
      style: {
        color: 'azure'
      }
    },
    xaxis: {
      categories: times,
      labels: {
        style: {
          colors: 'azure'
        }
      }
    },
    yaxis: {
      labels: {
        style: {
          colors: 'azure'
        }
      }
    }
  }

  return options
}

const renderChart = async (document, period_from) => {
  document.body.style.cursor = 'wait'
  const chartElement = document.getElementById('chart')
  let consumption
  if (localStorage.getItem('account')) {
    consumption = await getConsumption(
      localStorage.getItem('account'),
      localStorage.getItem('token'),
      period_from
    )
  }
  const chartOptions = await createChartOptions(
    document.getElementById('region').value,
    period_from,
    consumption
  )
  if (!existingChart) {
    existingChart = new ApexCharts(chartElement, chartOptions)
    await existingChart.render()
  } else {
    existingChart.updateOptions(chartOptions)
  }
  document.body.style.cursor = 'default'
}

const toggleAccountForm = (document) => {
  document.getElementById('showSignInBtn').classList.toggle('is-hidden')
  document.getElementById('signOutBtn').classList.toggle('is-hidden')
}

const loadAccountForm = (document) => {
  const account = localStorage.getItem('account')
  const token = localStorage.getItem('token')

  document.getElementById('signOutBtn').addEventListener('click', async () => {
    localStorage.removeItem('account')
    localStorage.removeItem('token')
    toggleAccountForm(document)
  })

  Array.from(document.getElementsByClassName('delete')).forEach((e) => {
    e.addEventListener('click', () => {
      e.parentElement.parentElement.parentElement.classList.remove('is-active')
    })
  })

  if (account && token) {
    toggleAccountForm(document)
  }

  document
    .getElementById('showSignInBtn')
    .addEventListener('click', async () => {
      document.getElementById('signInModal').classList.toggle('is-active')
    })

  document.getElementById('signInBtn').addEventListener('click', async () => {
    const token = document.getElementById('token').value
    const account = document.getElementById('account').value
    if (account && token) {
      localStorage.setItem('account', account)
      localStorage.setItem('token', token)
      toggleAccountForm(document)
      document.getElementById('signInModal').classList.toggle('is-active')
    }
  })
}

const loadRegionDropdown = (window, document) => {
  const urlParams = new URLSearchParams(window.location.search)
  document.getElementById('region').value = urlParams.get('region') || 'A'
  document.getElementById('region').addEventListener('change', async () => {
    const urlParams = new URLSearchParams(window.location.search)
    urlParams.set('region', document.getElementById('region').value)
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?${urlParams}`
    )
    await renderChart(document)
  })
}

const onload = async (window, document) => {
  const today = new Date()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const calendar = bulmaCalendar.attach('[type="date"]', {
    maxDate: tomorrow,
    startDate: today,
    dateFormat: 'yyyy-MM-dd',
    onReady: async (calendar) => {
      const period_from = new Date(calendar.data.value())
      loadAccountForm(document)
      loadRegionDropdown(window, document)
      await renderChart(document, period_from)
    }
  })[0]
  calendar.on('hide', async (calendar) => {
    const period_from = new Date(calendar.data.value())
    await renderChart(document, period_from)
  })
}
