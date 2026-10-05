export const pm25Response = {
  code: 0,
  data: {
    regionMetadata: [
      { name: "north", labelLocation: { latitude: 1.41803, longitude: 103.82 } },
      { name: "south", labelLocation: { latitude: 1.29587, longitude: 103.82 } },
      { name: "east", labelLocation: { latitude: 1.35735, longitude: 103.94 } },
      { name: "west", labelLocation: { latitude: 1.35735, longitude: 103.7 } },
      { name: "central", labelLocation: { latitude: 1.35735, longitude: 103.82 } },
    ],
    items: [
      {
        timestamp: new Date().toISOString(),
        updatedTimestamp: new Date().toISOString(),
        readings: { pm25_one_hourly: { north: 10, south: 20, east: 30, west: 40, central: 50 } },
      },
    ],
  },
};

export const psiResponse = {
  code: 0,
  data: {
    items: [
      {
        timestamp: new Date().toISOString(),
        updatedTimestamp: new Date().toISOString(),
        readings: {
          psi_twenty_four_hourly: { north: 40, south: 50, east: 60, west: 70, central: 80 },
        },
      },
    ],
  },
};
