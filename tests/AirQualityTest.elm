module AirQualityTest exposing (reading, tests)

import AirQuality as AQ exposing (Reading)
import Dict
import Expect
import Fuzz
import Test exposing (..)


reading : Reading
reading =
    { values = Dict.fromList [ ( "north", 10 ), ( "south", 20 ), ( "east", 30 ), ( "west", 40 ), ( "central", 50 ) ]
    , timestamp = "12 Oct, 10:00 am"
    , stale = False
    , source = "live"
    , fingerprint = "fixture"
    , references =
        [ { name = "north", coordinate = { latitude = 1.41803, longitude = 103.82 } }
        , { name = "south", coordinate = { latitude = 1.29587, longitude = 103.82 } }
        , { name = "east", coordinate = { latitude = 1.35735, longitude = 103.94 } }
        , { name = "west", coordinate = { latitude = 1.35735, longitude = 103.7 } }
        , { name = "central", coordinate = { latitude = 1.35735, longitude = 103.82 } }
        ]
    }


tests : Test
tests =
    describe "Air quality calculations (shared TypeScript/browser fixtures)"
        [ test "exact reference gives only that region weight" <|
            \_ ->
                case AQ.estimate { latitude = 1.35735, longitude = 103.94 } reading of
                    Ok estimate ->
                        Expect.equal ( 30, "east", [ 0, 0, 1, 0, 0 ] ) ( estimate.value, estimate.closestRegion, List.map .weight estimate.contributions )

                    Err message ->
                        Expect.fail message
        , test "inverse-square interpolation matches the browser/map fixture" <|
            \_ ->
                case AQ.estimate { latitude = 1.32, longitude = 103.88 } reading of
                    Ok estimate ->
                        Expect.within (Expect.Absolute 0.0001) 30.5305 estimate.value

                    Err message ->
                        Expect.fail message
        , fuzz2 (Fuzz.floatRange 1.13 1.5) (Fuzz.floatRange 103.59 104.1) "weights normalize and stay within the source range" <|
            \latitude longitude ->
                case AQ.estimate { latitude = latitude, longitude = longitude } reading of
                    Ok estimate ->
                        Expect.all
                            [ \e -> Expect.within (Expect.Absolute 0.000000000001) 1 (List.sum (List.map .weight e.contributions))
                            , \e -> Expect.equal True (e.value >= 10 && e.value <= 50)
                            , \e -> Expect.equal True (List.all (\c -> c.weight >= 0) e.contributions)
                            ]
                            estimate

                    Err message ->
                        Expect.fail message
        , test "uniform sources produce a uniform estimate" <|
            \_ ->
                let
                    uniform =
                        { reading | values = Dict.map (\_ _ -> 42) reading.values }
                in
                case AQ.estimate { latitude = 1.32, longitude = 103.88 } uniform of
                    Ok estimate ->
                        Expect.within (Expect.Absolute 0.000000001) 42 estimate.value

                    Err message ->
                        Expect.fail message
        , test "rejects an outside coordinate" <|
            \_ ->
                AQ.estimate { latitude = 51.5072, longitude = -0.1276 } reading
                    |> Expect.equal (Err "Your location is outside the Singapore coverage area. Choose a region instead.")
        , test "rejects missing references" <|
            \_ ->
                AQ.estimate { latitude = 1.35, longitude = 103.82 } { reading | references = List.take 4 reading.references }
                    |> Expect.equal (Err "All five regional reference points are required.")
        , test "classifies PM2.5 before rounding" <|
            \_ ->
                List.map AQ.pm25Band [ 55, 55.01, 150, 150.01, 250, 250.01 ]
                    |> Expect.equal [ ( 1, "Normal" ), ( 2, "Elevated" ), ( 2, "Elevated" ), ( 3, "High" ), ( 3, "High" ), ( 4, "Very High" ) ]
        , test "PSI uses separate official thresholds" <|
            \_ ->
                List.map AQ.psiBand [ 50, 50.01, 100, 100.01, 200, 200.01, 300, 300.01 ]
                    |> Expect.equal [ ( 1, "Good" ), ( 2, "Moderate" ), ( 2, "Moderate" ), ( 3, "Unhealthy" ), ( 3, "Unhealthy" ), ( 4, "Very unhealthy" ), ( 4, "Very unhealthy" ), ( 5, "Hazardous" ) ]
        ]
