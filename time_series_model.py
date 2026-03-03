import yfinance as yf
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.preprocessing import StandardScaler
from statsmodels.tsa.seasonal import seasonal_decompose
import matplotlib.pyplot as plt

def create_dataset_manual(data, window_size):
    X, y = [], []
    for i in range(len(data) - window_size):
        X.append(data[i:(i + window_size)])
        y.append(data[i + window_size])
    return np.array(X), np.array(y)

def create_lstm_model(window_size, features=1):
    model = tf.keras.models.Sequential([
        tf.keras.layers.InputLayer(shape=(window_size, features)),
        tf.keras.layers.LSTM(50, return_sequences=True),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.LSTM(50),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(1)
    ])
    model.compile(optimizer='adam', loss='mean_squared_error')
    return model

def main():
    print("Downloading stock data...")
    # 1. Provide historical time series financial data
    stock_data = yf.download('AAPL', start='2010-01-01', end='2020-01-01')
    raw_close = stock_data['Close'].dropna().values

    # Convert to log returns for stability
    log_returns = np.log(raw_close[1:] / raw_close[:-1])

    # Scale data
    print("Scaling and preparing data...")
    scaler = StandardScaler()
    scaled_data = scaler.fit_transform(log_returns.reshape(-1, 1))

    window_size = 20

    # Split train/test (80% train)
    split_idx = int(len(scaled_data) * 0.8)
    
    train_data = scaled_data[:split_idx]
    test_data = scaled_data[split_idx:]

    X_train, y_train = create_dataset_manual(train_data, window_size)
    X_test, y_test = create_dataset_manual(test_data, window_size)

    # 2. Convert to TensorFlow Datasets
    batch_size = 32
    train_dataset = tf.data.Dataset.from_tensor_slices((X_train, y_train))
    train_dataset = train_dataset.batch(batch_size).prefetch(tf.data.AUTOTUNE)

    test_dataset = tf.data.Dataset.from_tensor_slices((X_test, y_test))
    test_dataset = test_dataset.batch(batch_size).prefetch(tf.data.AUTOTUNE)

    # 3. Model Training
    print("Training LSTM Model...")
    lstm_model = create_lstm_model(window_size, features=1)
    
    history = lstm_model.fit(
        train_dataset, 
        epochs=10, 
        validation_data=test_dataset,
        verbose=1
    )

    # 4. Feature Extraction & Volatility Modeling
    print("Decomposing time series components...")
    # Use additive model on recent 365 days of Close prices (ensure non-negativity implicitly handled if needed)
    recent_close = pd.Series(raw_close[-365*2:]) 
    decomposition = seasonal_decompose(recent_close, model='additive', period=30)
    
    fig, axes = plt.subplots(4, 1, figsize=(10, 8), sharex=True)
    decomposition.observed.plot(ax=axes[0], title='Observed')
    decomposition.trend.plot(ax=axes[1], title='Trend')
    decomposition.seasonal.plot(ax=axes[2], title='Seasonal')
    decomposition.resid.plot(ax=axes[3], title='Residual')
    plt.tight_layout()
    plt.savefig('decomposition.png')
    print("Saved decomposition plot to decomposition.png")

if __name__ == '__main__':
    main()
