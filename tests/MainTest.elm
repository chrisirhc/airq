module MainTest exposing (tests)

import AirQuality exposing (Metric(..))
import AirQualityTest exposing (reading)
import Expect
import Json.Encode as E
import Main exposing (Msg(..))
import Set
import Test exposing (..)


loaded : Main.Model
loaded =
    let
        initial =
            Main.init "system" |> Tuple.first
    in
    { initial | snapshot = Just { pm25 = Available reading, psi = Available reading }, loading = False }


step : Msg -> Main.Model -> Main.Model
step msg model =
    Main.update msg model |> Tuple.first


position : Int -> Msg
position requestId =
    Received
        (E.object
            [ ( "kind", E.string "position" )
            , ( "id", E.int requestId )
            , ( "capturedAt", E.float 1000 )
            , ( "coordinate", E.object [ ( "latitude", E.float 1.32 ), ( "longitude", E.float 103.88 ) ] )
            ]
        )


tests : Test
tests =
    describe "Elm application state"
        [ test "manual selection invalidates a pending geolocation callback" <|
            \_ ->
                loaded
                    |> step RequestLocation
                    |> step (SelectRegion "west")
                    |> step (position 1)
                    |> (\model -> Expect.equal ( "west", Nothing, False ) ( model.region, model.location, model.requesting ))
        , test "location becomes active only after a successful estimate" <|
            \_ ->
                loaded
                    |> step RequestLocation
                    |> step (position 1)
                    |> (\model -> Expect.equal ( True, False, "" ) ( model.location /= Nothing, model.requesting, model.error ))
        , test "late OneMap results cannot undo manual selection" <|
            \_ ->
                loaded
                    |> step RequestLocation
                    |> step (position 1)
                    |> step (SelectRegion "west")
                    |> step (Received (E.object [ ( "kind", E.string "locationName" ), ( "id", E.int 1 ), ( "name", E.string "Late name" ) ]))
                    |> (\model -> Expect.equal Nothing model.location)
        , test "late permission errors do not overwrite newer state" <|
            \_ ->
                loaded
                    |> step RequestLocation
                    |> step (SelectRegion "west")
                    |> step (Received (E.object [ ( "kind", E.string "locationError" ), ( "id", E.int 1 ), ( "message", E.string "Denied" ), ( "denied", E.bool True ) ]))
                    |> (\model -> Expect.equal "" model.error)
        , test "disclosures survive retries and manual selection" <|
            \_ ->
                loaded
                    |> step (Toggle "reading-guidance" True)
                    |> step Retry
                    |> step (SelectRegion "east")
                    |> (\model -> Expect.equal (Set.singleton "reading-guidance") model.disclosures)
        , test "theme cycles back to the system preference" <|
            \_ ->
                loaded
                    |> step CycleTheme
                    |> step CycleTheme
                    |> step CycleTheme
                    |> (\model -> Expect.equal "system" model.theme)
        , test "unknown regions cannot enter the model" <|
            \_ ->
                loaded |> step (SelectRegion "invalid") |> (\model -> Expect.equal "central" model.region)
        , test "malformed snapshots show an unavailable result, not zero" <|
            \_ ->
                loaded
                    |> step (Received (E.object [ ( "kind", E.string "snapshot" ), ( "snapshot", E.null ) ]))
                    |> (\model -> Expect.equal (Just { pm25 = Unavailable "The data source returned an unexpected response.", psi = Unavailable "The data source returned an unexpected response." }) model.snapshot)
        ]
