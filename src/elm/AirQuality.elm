module AirQuality exposing (Contribution, Coordinate, Estimate, Metric(..), Reading, Reference, Snapshot, decoder, estimate, pm25Band, psiBand, regionalValue, regions, weightedValue)

import Dict exposing (Dict)
import Json.Decode as D exposing (Decoder)


regions : List String
regions =
    [ "north", "south", "east", "west", "central" ]


type alias Coordinate =
    { latitude : Float, longitude : Float }


type alias Reference =
    { name : String, coordinate : Coordinate }


type alias Reading =
    { values : Dict String Float
    , timestamp : String
    , stale : Bool
    , source : String
    , references : List Reference
    , fingerprint : String
    }


type Metric
    = Available Reading
    | Unavailable String


type alias Snapshot =
    { pm25 : Metric, psi : Metric }


type alias Contribution =
    { region : String, value : Float, distanceMeters : Float, weight : Float }


type alias Estimate =
    { value : Float, closestRegion : String, contributions : List Contribution }


regionalValue : String -> Reading -> Float
regionalValue region reading =
    Dict.get region reading.values |> Maybe.withDefault 0


weightedValue : List Contribution -> Float
weightedValue =
    List.map (\c -> c.value * c.weight) >> List.sum


estimate : Coordinate -> Reading -> Result String Estimate
estimate coordinate reading =
    if coordinate.latitude < 1.13 || coordinate.latitude > 1.5 || coordinate.longitude < 103.59 || coordinate.longitude > 104.1 then
        Err "Your location is outside the Singapore coverage area. Choose a region instead."

    else if List.length reading.references /= 5 then
        Err "All five regional reference points are required."

    else
        let
            points =
                List.map (\r -> { region = r.name, value = regionalValue r.name reading, distanceMeters = distance coordinate r.coordinate, weight = 0 }) reading.references

            closest =
                List.sortBy .distanceMeters points |> List.head
        in
        case closest of
            Nothing ->
                Err "All five regional reference points are required."

            Just nearest ->
                let
                    raw c =
                        if nearest.distanceMeters <= 1 then
                            if c.region == nearest.region then
                                1

                            else
                                0

                        else
                            (nearest.distanceMeters / c.distanceMeters) ^ 2

                    total =
                        List.map raw points |> List.sum

                    contributions =
                        List.map (\c -> { c | weight = raw c / total }) points
                in
                Ok { value = weightedValue contributions, closestRegion = nearest.region, contributions = contributions }


distance : Coordinate -> Coordinate -> Float
distance from to =
    let
        radians x =
            x * pi / 180

        a =
            sin (radians (to.latitude - from.latitude) / 2)
                ^ 2
                + cos (radians from.latitude)
                * cos (radians to.latitude)
                * sin (radians (to.longitude - from.longitude) / 2)
                ^ 2
    in
    2 * 6371000 * atan2 (sqrt a) (sqrt (1 - a))


pm25Band : Float -> ( Int, String )
pm25Band value =
    if value <= 55 then
        ( 1, "Normal" )

    else if value <= 150 then
        ( 2, "Elevated" )

    else if value <= 250 then
        ( 3, "High" )

    else
        ( 4, "Very High" )


psiBand : Float -> ( Int, String )
psiBand value =
    if value <= 50 then
        ( 1, "Good" )

    else if value <= 100 then
        ( 2, "Moderate" )

    else if value <= 200 then
        ( 3, "Unhealthy" )

    else if value <= 300 then
        ( 4, "Very unhealthy" )

    else
        ( 5, "Hazardous" )


decoder : Decoder Snapshot
decoder =
    D.map2 Snapshot (D.field "pm25" metricDecoder) (D.field "psi" metricDecoder)


metricDecoder : Decoder Metric
metricDecoder =
    D.field "kind" D.string
        |> D.andThen
            (\kind ->
                if kind == "available" then
                    D.map Available readingDecoder

                else if kind == "unavailable" then
                    D.map Unavailable (D.field "message" D.string)

                else
                    D.fail "Unknown metric result"
            )


readingDecoder : Decoder Reading
readingDecoder =
    D.map6 Reading
        (D.field "values" valuesDecoder)
        (D.field "timestamp" D.string)
        (D.field "stale" D.bool)
        (D.field "source" D.string)
        (D.field "references" (D.list (D.map2 Reference (D.field "name" D.string) (D.field "coordinate" (D.map2 Coordinate (D.field "latitude" D.float) (D.field "longitude" D.float))))))
        (D.field "fingerprint" D.string)


valuesDecoder : Decoder (Dict String Float)
valuesDecoder =
    let
        nonnegative =
            D.float
                |> D.andThen
                    (\value ->
                        if value >= 0 then
                            D.succeed value

                        else
                            D.fail "Readings must be nonnegative"
                    )
    in
    D.map5 (\north south east west central -> Dict.fromList [ ( "north", north ), ( "south", south ), ( "east", east ), ( "west", west ), ( "central", central ) ])
        (D.field "north" nonnegative)
        (D.field "south" nonnegative)
        (D.field "east" nonnegative)
        (D.field "west" nonnegative)
        (D.field "central" nonnegative)
